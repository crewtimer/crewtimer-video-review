import fs from 'fs';
import path from 'path';
import webpackPaths from '../configs/webpack.paths';

function deleteJsSourceMaps(dir) {
  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith('.js.map')) {
      fs.rmSync(path.join(dir, entry), { force: true });
    }
  }
}

export default function deleteSourceMaps() {
  if (fs.existsSync(webpackPaths.distMainPath)) {
    deleteJsSourceMaps(webpackPaths.distMainPath);
  }
  if (fs.existsSync(webpackPaths.distRendererPath)) {
    deleteJsSourceMaps(webpackPaths.distRendererPath);
  }
}
