const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = /\{\{nodo:([^}]+)\}\}/g;

function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    throw new Error(`Ruta inválida: ${relative}`);
  }
  const resolved = path.resolve(root, relative);
  const local = path.relative(root, resolved);
  if (!local || local === '..' || local.startsWith(`..${path.sep}`) || path.isAbsolute(local)) {
    throw new Error(`Ruta fuera del proyecto: ${relative}`);
  }
  return resolved;
}

function assemble(root = ROOT) {
  const sourceRoot = path.join(root, 'renderer');
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'manifest.json'), 'utf8'));
  const output = inside(root, manifest.output);
  if (path.extname(output) !== '.htm') throw new Error('La salida debe ser un archivo .htm');
  const template = fs.readFileSync(path.join(sourceRoot, 'panel.template.html'), 'utf8');
  const blocks = new Map();
  const assets = new Map();
  const sourceFiles = new Set();
  for (const block of manifest.blocks) {
    if (!/^(js|css):[a-z0-9-]+$/.test(block.id) || blocks.has(block.id)) throw new Error(`Bloque duplicado o sin id: ${block.id}`);
    if (!['script', 'style'].includes(block.type) || !block.sources?.length) {
      throw new Error(`Bloque inválido: ${block.id}`);
    }
    const content = block.sources.map(file => {
      const absolute = inside(sourceRoot, file);
      if (sourceFiles.has(absolute)) throw new Error(`Fuente duplicada: ${file}`);
      sourceFiles.add(absolute);
      return fs.readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n');
    }).join('');
    if (new RegExp(`</${block.type}\\s*>`, 'i').test(content)) {
      throw new Error(`Cierre HTML dentro del bloque: ${block.id}`);
    }
    // Parsear juntos preserva y verifica las declaraciones léxicas y el hoisting.
    if (block.type === 'script') new vm.Script(content, { filename: block.id });
    blocks.set(block.id, { content, type: block.type, inline: block.inline, count: 0 });
  }
  function getBlock(id) {
    const block = blocks.get(id);
    if (!block) throw new Error(`Bloque desconocido: ${id}`);
    block.count++;
    return block;
  }
  const normalizedTemplate = template.replace(/\r\n/g, '\n');
  const html = manifest.externalAssets ? normalizedTemplate.replace(
    /<(script|style)\b([^>]*)>\s*\{\{nodo:([^}]+)\}\}\s*<\/\1\s*>/gi,
    (_, tag, attributes, id) => {
      const block = getBlock(id);
      if(tag !== block.type) throw new Error(`Tipo de etiqueta incorrecto: ${id}`);
      if(block.inline) return `<${tag}${attributes}>${block.content}</${tag}>`;
      const relative = 'renderer/generated/' + id.replace(':', '-') + (tag === 'script' ? '.js' : '.css');
      assets.set(inside(root, relative), block.content);
      // Scripts clásicos y bloqueantes: las extensiones conservan su orden y sus ids.
      return tag === 'script' ? `<script${attributes} src="${relative}"></script>`
        : `<link${attributes} rel="stylesheet" href="${relative}">`;
    }
  ) : normalizedTemplate.replace(TOKEN, (_, id) => getBlock(id).content);
  if(TOKEN.test(html)) throw new Error('Token de bloque fuera de su etiqueta script/style');
  for (const [id, block] of blocks) {
    if (block.count !== 1) throw new Error(`El bloque ${id} debe aparecer una vez (aparece ${block.count})`);
  }
  return { html, output, assets, blocks: blocks.size, sources: sourceFiles.size };
}

function build({ root = ROOT, check = false } = {}) {
  const result = assemble(root);
  const outputs = new Map([...result.assets, [result.output, result.html]]);
  const pending = [...outputs].filter(([file, content]) => {
    const actual = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    return actual !== content;
  });
  const changed = pending.length > 0;
  if (check && changed) throw new Error('Panel desactualizado. Ejecutá npm run panel:build.');
  if (!check) for(const [file, content] of pending) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return { ...result, changed };
}

if (require.main === module) {
  try {
    const result = build({ check: process.argv.includes('--check') });
    console.log(`Panel OK: ${result.blocks} bloques, ${result.sources} fuentes${result.changed ? ' (actualizado)' : ' (sin cambios)'}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { assemble, build };
