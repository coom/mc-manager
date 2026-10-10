#!/usr/bin/env node
// Génère src/components/console/registry.json (identifiants vanilla utilisés par la
// complétion de la console) à partir du paquet minecraft-data.
//   node packages/frontend/scripts/gen-mc-registry.mjs [version]
// Sans argument : la version Java la plus récente supportée par minecraft-data.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const mcData = require('minecraft-data');
const versions = mcData.supportedVersions.pc;
const version = process.argv[2] ?? versions[versions.length - 1];
const data = mcData(version);
if (!data) {
  console.error(`Version inconnue : ${version}. Versions disponibles : ${versions.join(', ')}`);
  process.exit(1);
}

const ids = (arr) => [...new Set(arr.map((e) => e.name))].sort();
// Les effets sont en CamelCase dans minecraft-data (InstantHealth) ; les commandes attendent instant_health.
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
// Noms minecraft-data dont la forme snake_case n'est pas l'identifiant de commande.
const EFFECT_ALIASES = { bad_luck: 'unluck' };
const effectId = (name) => EFFECT_ALIASES[snake(name)] ?? snake(name);

const registry = {
  version: data.version.minecraftVersion,
  items: ids(data.itemsArray),
  blocks: ids(data.blocksArray),
  entities: ids(data.entitiesArray),
  effects: [...new Set(data.effectsArray.map((e) => effectId(e.name)))].sort(),
  enchantments: ids(data.enchantmentsArray),
};
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'console', 'registry.json');
writeFileSync(out, JSON.stringify(registry) + '\n');
console.log(`registry.json écrit pour Minecraft ${registry.version} : ${registry.items.length} objets, ${registry.blocks.length} blocs, ${registry.entities.length} entités, ${registry.effects.length} effets, ${registry.enchantments.length} enchantements`);
