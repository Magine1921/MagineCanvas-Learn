interface TrialEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: TrialEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return Response.json(
        {
          error: '在线试用体验版功能受限',
          message: '该服务端或桌面专属能力未在网页体验版开放，请使用正式桌面版。',
        },
        { status: 501 },
      );
    }
    return env.ASSETS.fetch(request);
  },
};
