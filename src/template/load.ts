import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const TEMPLATES_DIR = 'templates';
export const DEFAULT_TEMPLATE = 'default';

const TEMPLATE_SUFFIX = '.html.eta';

const templateFileName = (name: string): string => `${name}${TEMPLATE_SUFFIX}`;

export interface LoadedTemplate {
  name: string;
  source: string;
}

/** Names of every template available to `--template`. */
export async function listTemplates(dir: string = TEMPLATES_DIR): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files
      .filter((f) => f.endsWith(TEMPLATE_SUFFIX))
      .map((f) => f.slice(0, -TEMPLATE_SUFFIX.length))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Resolve a template name to its source. Templates are plain files rather than
 * anything bundled, so the ones that ship with the repo and the ones you write
 * are the same kind of thing and live in the same place.
 */
export async function loadTemplate(
  name: string = DEFAULT_TEMPLATE,
  dir: string = TEMPLATES_DIR,
): Promise<LoadedTemplate> {
  try {
    return { name, source: await readFile(join(dir, templateFileName(name)), 'utf8') };
  } catch {
    const available = await listTemplates(dir);
    throw new Error(
      `unknown template "${name}". Available in ${dir}/: ${available.join(', ') || '(none)'}`,
    );
  }
}

/** Write a template to `templates/<name>.html.eta`, returning the path. */
export async function writeTemplate(
  name: string,
  source: string,
  dir: string = TEMPLATES_DIR,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, templateFileName(name));
  await writeFile(path, source.endsWith('\n') ? source : `${source}\n`, 'utf8');
  return path;
}
