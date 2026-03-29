const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

async function run() {
  const ctx = await esbuild.context({
    entryPoints: ['src/renderer/index.js'],
    bundle: true,
    outfile: 'src/dist/renderer.js',
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  if (watch) {
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
