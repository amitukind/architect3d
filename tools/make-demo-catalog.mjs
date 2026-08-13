#!/usr/bin/env node
/**
 * Generate the legacy demo's item palette from the unified catalog.
 *
 *   npm run catalog
 *
 * Reads  src/catalog/catalog.json   (the source of truth as of sprint S3)
 * Writes build/js/items.js          (generated; do not edit by hand)
 *
 * Before S3 the palette lived in two hand-maintained jQuery files:
 * items.js held 27 legacy-JSON models and only knew about six of the eight
 * item types, items_gltf.js held 142 glTF models and knew about all eight. They
 * disagreed about which types exist, and one of items.js' entries pointed at a
 * cabinet.json that has never been in the repository. Both are now derived from
 * one JSON file that the Vue app will read directly in S7, and items_gltf.js is
 * gone.
 *
 * The emitted file is deliberately still a jQuery script: build/ is the frozen
 * legacy demo and keeps working exactly as it did until S6 replaces it.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'src/catalog/catalog.json');
const OUTPUT = join(ROOT, 'build/js/items.js');

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
const typeKeys = Object.keys(catalog.itemTypes).sort((a, b) => Number(a) - Number(b));

const entries = catalog.items
	.map((item) => `\t\t{"name": ${JSON.stringify(item.name)}, "image": ${JSON.stringify(item.image)}, "model": ${JSON.stringify(item.model)}, "type": "${item.type}", "format": ${JSON.stringify(item.format)}}`)
	.join(',\n');

const source = `// GENERATED FILE - do not edit.
//
// Source:    src/catalog/catalog.json
// Generator: tools/make-demo-catalog.mjs  (npm run catalog)
//
// ${catalog.items.length} items. Every one of them is glTF as of migration sprint S3;
// the 25 models that used to ship as three.js JSON now live in models/js-glb/,
// converted by tools/convert-legacy-json.mjs. Designs saved with the old URLs
// keep working - the library rewrites them on load, see
// src/scripts/core/legacy_models.js.
$(document).ready(function() {
	var items = [
${entries}
	];

	var modelTypesNum = [${typeKeys.map((key) => `"${key}"`).join(', ')}];
	var modelTypesIds = [${typeKeys.map((key) => JSON.stringify(catalog.itemTypes[key].wrapper)).join(', ')}];

	for (var i = 0; i < items.length; i++)
	{
		var item = items[i];
		var itemsDiv = $("#" + modelTypesIds[modelTypesNum.indexOf(item.type)] + "-wrapper");
		var modelformat = (item.format) ? ' model-format="' + item.format + '"' : "";
		var html = '<div class="col-sm-4">' + '<a class="thumbnail add-item"' + ' model-name="' + item.name + '"' + ' model-url="' + item.model + '"' + ' model-type="' + item.type + '"' + modelformat + '>' + '<img src="' + item.image + '" alt="Add Item" data-dismiss="modal"> ' + item.name + '</a></div>';
		itemsDiv.append(html);
	}
});
`;

writeFileSync(OUTPUT, source);

const byType = catalog.items.reduce((counts, item) =>
{
	counts[item.type] = (counts[item.type] || 0) + 1;
	return counts;
}, {});
console.log(`build/js/items.js <- ${catalog.items.length} items`);
for (const key of typeKeys)
{
	console.log(`  type ${key}  ${String(byType[key] || 0).padStart(3)}  ${catalog.itemTypes[key].label}`);
}
