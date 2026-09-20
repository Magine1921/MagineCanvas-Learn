/**
 * Tailwind v4 / Lightning CSS 生产构建有时只保留 -webkit-backdrop-filter，
 * Electron 33 需要标准 backdrop-filter 才能渲染节点磨砂玻璃。
 */
function backdropFilterFix() {
  return {
    postcssPlugin: 'magine-backdrop-filter-fix',
    Declaration(decl) {
      if (decl.prop === '-webkit-backdrop-filter') {
        const rule = decl.parent;
        if (!rule) return;
        const hasStandard = rule.nodes.some(
          (node) => node.type === 'decl' && node.prop === 'backdrop-filter'
        );
        if (!hasStandard) {
          rule.append({
            prop: 'backdrop-filter',
            value: decl.value,
            important: decl.important,
          });
        }
        return;
      }

      if (decl.prop === 'backdrop-filter') {
        const rule = decl.parent;
        if (!rule) return;
        const hasWebkit = rule.nodes.some(
          (node) => node.type === 'decl' && node.prop === '-webkit-backdrop-filter'
        );
        if (!hasWebkit) {
          rule.prepend({
            prop: '-webkit-backdrop-filter',
            value: decl.value,
            important: decl.important,
          });
        }
      }
    },
  };
}

backdropFilterFix.postcss = true;

module.exports = backdropFilterFix;
