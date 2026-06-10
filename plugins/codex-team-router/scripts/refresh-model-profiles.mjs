#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

const catalogPaths = process.env.CODEX_MODEL_CATALOG
  ? [process.env.CODEX_MODEL_CATALOG]
  : [
      join(homedir(), ".codex", "cc-switch-model-catalog.json"),
      join(homedir(), ".codex", "models_cache.json")
    ];
const outputPath =
  process.argv[2] ||
  join(process.cwd(), "references", "model-profiles.generated.json");

const documentedDefaults = {
  smartest_deep: {
    model: "gpt-5.5",
    model_reasoning_effort: "xhigh"
  },
  smartest_review: {
    model: "gpt-5.5",
    model_reasoning_effort: "high"
  },
  smart_code: {
    model: "gpt-5.4",
    model_reasoning_effort: "high"
  },
  smart_verify: {
    model: "gpt-5.4",
    model_reasoning_effort: "medium"
  },
  fast_scan: {
    model: "gpt-5.4-mini",
    model_reasoning_effort: "low"
  }
};

function normalizeModels(data) {
  if (Array.isArray(data.models)) return data.models;
  if (Array.isArray(data)) return data;
  return [];
}

function readCatalog(path) {
  if (!existsSync(path)) {
    return { path, models: [], warning: `Catalog not found: ${path}` };
  }

  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return { path, models: normalizeModels(data), warning: null };
  } catch (error) {
    return { path, models: [], warning: `Could not parse catalog ${path}: ${error.message}` };
  }
}

function loadCatalogs(paths) {
  const warnings = [];
  const modelsBySlug = new Map();
  const modelSourceBySlug = new Map();
  const reads = paths.map(readCatalog);

  for (const read of reads) {
    if (read.warning && process.env.CODEX_MODEL_CATALOG) warnings.push(read.warning);
    for (const model of read.models) {
      if (!model || typeof model.slug !== "string") continue;
      if (!modelsBySlug.has(model.slug)) {
        modelsBySlug.set(model.slug, model);
        modelSourceBySlug.set(model.slug, read.path);
      }
    }
  }

  if (modelsBySlug.size === 0) {
    for (const read of reads) {
      if (read.warning) warnings.push(read.warning);
    }
  }

  return {
    reads,
    models: [...modelsBySlug.values()],
    modelsBySlug,
    modelSourceBySlug,
    warnings
  };
}

function hasReasoning(model, effort) {
  const levels = model.supported_reasoning_levels || [];
  return levels.some((level) => level && level.effort === effort);
}

function visibleModelSlugs(models) {
  return models
    .filter((model) => model && typeof model.slug === "string")
    .filter((model) => model.visibility !== "hidden")
    .map((model) => model.slug);
}

function resolveProfile(profile, modelsBySlug, modelSourceBySlug, warnings) {
  const wanted = documentedDefaults[profile];
  const model = modelsBySlug.get(wanted.model);

  if (!model) {
    warnings.push(
      `${profile}: ${wanted.model} is not present in the local Codex model catalog; keeping documented default.`
    );
    return { ...wanted, source: "documented-default" };
  }

  if (!hasReasoning(model, wanted.model_reasoning_effort)) {
    warnings.push(
      `${profile}: ${wanted.model} is present but does not advertise reasoning effort ${wanted.model_reasoning_effort}; keeping profile for manual review.`
    );
  }

  return {
    ...wanted,
    source: "local-catalog",
    catalog_path: modelSourceBySlug.get(wanted.model) || null,
    catalog_name: modelSourceBySlug.has(wanted.model)
      ? basename(modelSourceBySlug.get(wanted.model))
      : null
  };
}

const {
  reads,
  models,
  modelsBySlug,
  modelSourceBySlug,
  warnings
} = loadCatalogs(catalogPaths);
const primaryCatalogPath = reads.find((read) => read.models.length > 0)?.path || catalogPaths[0];

const profiles = Object.fromEntries(
  Object.keys(documentedDefaults).map((profile) => [
    profile,
    resolveProfile(profile, modelsBySlug, modelSourceBySlug, warnings)
  ])
);

const result = {
  version: 1,
  generated_at: new Date().toISOString(),
  catalog_path: primaryCatalogPath,
  catalog_paths_checked: catalogPaths,
  catalog_sources: reads.map((read) => ({
    path: read.path,
    model_count: read.models.length,
    warning: read.warning
  })),
  visible_models: visibleModelSlugs(models),
  profiles,
  warnings
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
if (warnings.length) {
  console.warn(warnings.join("\n"));
}
