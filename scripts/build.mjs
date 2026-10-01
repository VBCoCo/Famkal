import { build } from 'esbuild';
import sharp from 'sharp';
await build({ entryPoints: ['scripts/supabase-entry.js'], outfile: 'vendor/supabase.js', bundle: true, format: 'esm', platform: 'browser', target: ['safari16.4'], minify: true, legalComments: 'eof' });
await Promise.all([192,512].map(size=>sharp('icons/icon.svg').resize(size,size).png().toFile('icons/icon-'+size+'.png')));
