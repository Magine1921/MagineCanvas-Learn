from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "scripts" / "tutorial-audio-script.json"
MODEL_DIR = ROOT / ".runtime" / "tutorial-tts" / "models" / "Qwen3-TTS-12Hz-0.6B-CustomVoice"
RAW_DIR = ROOT / ".runtime" / "tutorial-tts" / "output" / "tutorial-all"
PUBLIC_DIR = ROOT / "public" / "tutorial-audio" / "zh-CN"

INSTRUCTION = (
    "请使用 Serena 中文女声进行产品教学讲解。语气亲切友好，带轻微微笑感，交流感强。"
    "声音略低沉、厚实、温暖，具有自然的胸腔共鸣，但不要压嗓、不要发闷。"
    "语速适中，吐字清晰，不夸张，不使用播音腔，句间保留自然的短暂停顿。"
)

FILTER = (
    "asetrate=22000,aresample=24000,atempo=1.090909,highpass=f=28,"
    "bass=g=13:f=145:w=1.0,equalizer=f=320:t=q:w=0.9:g=-3.0,"
    "equalizer=f=2500:t=q:w=1.0:g=1.2,"
    "acompressor=threshold=0.085:ratio=2.5:attack=10:release=120:makeup=1.25,"
    "loudnorm=I=-16:TP=-1.5:LRA=7"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate packaged tutorial narration audio.")
    parser.add_argument("--force", action="store_true", help="Regenerate clips that already exist.")
    parser.add_argument("--only", action="append", default=[], help="Generate only the specified clip id.")
    parser.add_argument("--seed-offset", type=int, default=0, help="Offset the deterministic voice seed for alternate takes.")
    parser.add_argument(
        "--ffmpeg",
        default=os.environ.get("FFMPEG_PATH", "ffmpeg"),
        help="FFmpeg executable path (default: FFMPEG_PATH or ffmpeg from PATH).",
    )
    parser.add_argument(
        "--ffprobe",
        default=os.environ.get("FFPROBE_PATH", "ffprobe"),
        help="FFprobe executable path (default: FFPROBE_PATH or ffprobe from PATH).",
    )
    return parser.parse_args()


def clip_paths(clip_id: str) -> tuple[Path, Path]:
    group, step = clip_id.split(".", 1)
    return RAW_DIR / group / f"{step}.raw.wav", PUBLIC_DIR / group / f"{step}.mp3"


def resolve_executable(value: str, label: str) -> str:
    candidate = Path(value).expanduser()
    if candidate.is_file():
        return str(candidate.resolve())
    discovered = shutil.which(value)
    if discovered:
        return discovered
    raise FileNotFoundError(
        f"{label} was not found. Pass its executable with --{label.lower()} "
        f"or set {label.upper()}_PATH."
    )


def audio_duration(path: Path, ffprobe: str) -> float:
    result = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return round(float(result.stdout.strip()), 3)


def process_audio(source: Path, destination: Path, ffmpeg: str, audio_filter: str = FILTER) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(source),
            "-af", audio_filter, "-ar", "24000", "-ac", "1", "-b:a", "64k", str(destination),
        ],
        check=True,
    )


def main() -> None:
    args = parse_args()
    ffmpeg = resolve_executable(args.ffmpeg, "FFmpeg")
    ffprobe = resolve_executable(args.ffprobe, "FFprobe")
    if not MODEL_DIR.exists():
        raise FileNotFoundError(f"Tutorial TTS model not found: {MODEL_DIR}")

    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    only = set(args.only)
    selected = [item for item in catalog if not only or item["id"] in only]
    if only - {item["id"] for item in selected}:
        raise ValueError(f"Unknown clip ids: {sorted(only - {item['id'] for item in selected})}")

    print(f"[tutorial-audio] loading model: {MODEL_DIR}", flush=True)
    model = Qwen3TTSModel.from_pretrained(
        str(MODEL_DIR),
        device_map="cuda:0",
        dtype=torch.bfloat16,
        attn_implementation="sdpa",
    )
    print(f"[tutorial-audio] generating {len(selected)} clips", flush=True)

    for index, item in enumerate(selected, start=1):
        clip_id = item["id"]
        raw_path, output_path = clip_paths(clip_id)
        if output_path.exists() and output_path.stat().st_size > 0 and not args.force:
            print(f"[{index:02d}/{len(selected):02d}] skip {clip_id}", flush=True)
            continue

        raw_path.parent.mkdir(parents=True, exist_ok=True)
        torch.manual_seed(20260840 + catalog.index(item) + args.seed_offset)
        print(f"[{index:02d}/{len(selected):02d}] synthesize {clip_id}", flush=True)
        wavs, sample_rate = model.generate_custom_voice(
            text=item["text"],
            language="Chinese",
            speaker="Serena",
            instruct=INSTRUCTION,
        )
        sf.write(raw_path, wavs[0], sample_rate)
        process_audio(raw_path, output_path, ffmpeg)
        print(f"[{index:02d}/{len(selected):02d}] ready {clip_id} ({audio_duration(output_path, ffprobe):.2f}s)", flush=True)

    clips = []
    for item in catalog:
        _, output_path = clip_paths(item["id"])
        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError(f"Missing generated tutorial clip: {item['id']}")
        group, step = item["id"].split(".", 1)
        clips.append(
            {
                "id": item["id"],
                "src": f"/tutorial-audio/zh-CN/{group}/{step}.mp3",
                "text": item["text"],
                "duration": audio_duration(output_path, ffprobe),
            }
        )

    manifest = {
        "version": 1,
        "locale": "zh-CN",
        "voice": "Serena",
        "preset": "friendly-ultra-bass",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "count": len(clips),
        "clips": clips,
    }
    manifest_path = PUBLIC_DIR / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[tutorial-audio] complete: {len(clips)} clips -> {PUBLIC_DIR}", flush=True)


if __name__ == "__main__":
    main()
