import { basename, dirname, extname, join } from 'node:path';
import type { AppSettingsPublic, ExportVariant, SubtitleFileFormat } from '@shared/models';

type SubtitleExportSettings = Pick<
  AppSettingsPublic,
  'exportDestinationMode' | 'exportDirectory' | 'exportFileFormat' | 'exportBatchWithLanguageSuffix'
>;

export type SubtitleExportPathPlan = {
  defaultName: string;
  defaultPath: string;
  requiresSaveDialog: boolean;
};

export type SubtitleExportPathOptions = {
  batchExport?: boolean;
  interactive?: boolean;
  targetLanguage?: string;
};

export function planSubtitleExportPath(
  mediaPath: string,
  variant: ExportVariant,
  settings: SubtitleExportSettings,
  options: SubtitleExportPathOptions = {}
): SubtitleExportPathPlan {
  const defaultName = defaultSubtitleFileName(mediaPath, variant, settings.exportFileFormat, {
    batchExport: options.batchExport,
    includeLanguageSuffix: settings.exportBatchWithLanguageSuffix,
    targetLanguage: options.targetLanguage
  });
  const sourceDirectoryPath = join(dirname(mediaPath), defaultName);
  if (options.interactive !== false && settings.exportDestinationMode === 'ask-each-time') {
    return {
      defaultName,
      defaultPath: sourceDirectoryPath,
      requiresSaveDialog: true
    };
  }

  const targetDir =
    settings.exportDestinationMode === 'selected-directory' && settings.exportDirectory
      ? settings.exportDirectory
      : dirname(mediaPath);
  return {
    defaultName,
    defaultPath: join(targetDir, defaultName),
    requiresSaveDialog: false
  };
}

export function defaultSubtitleFileName(
  mediaPath: string,
  variant: ExportVariant,
  format: SubtitleFileFormat,
  options: {
    batchExport?: boolean;
    includeLanguageSuffix?: boolean;
    targetLanguage?: string;
  } = {}
): string {
  const extension = extname(mediaPath);
  const name = basename(mediaPath, extension);
  if (options.batchExport) {
    const languageSuffix =
      options.includeLanguageSuffix && variant !== 'source' && options.targetLanguage?.trim()
        ? `_${options.targetLanguage.trim()}`
        : '';
    return `${name}${languageSuffix}.${format}`;
  }

  const suffix = variant === 'source' ? 'source' : variant === 'bilingual' ? 'bilingual' : 'translated';
  return `${name}.${suffix}.${format}`;
}

export function resolveSubtitleFileFormat(path: string, fallback: SubtitleFileFormat): SubtitleFileFormat {
  const extension = extname(path).toLowerCase();
  if (extension === '.ass') return 'ass';
  if (extension === '.srt') return 'srt';
  return fallback;
}

export function exportFileFormatMeta(format: SubtitleFileFormat): {
  extension: SubtitleFileFormat;
  filterName: string;
} {
  return format === 'ass'
    ? { extension: 'ass', filterName: 'Advanced SubStation Alpha' }
    : { extension: 'srt', filterName: 'SubRip Subtitle' };
}

export function avoidSubtitleFileOverwrite(
  path: string,
  fileExists: (candidatePath: string) => boolean
): string {
  if (!fileExists(path)) {
    return path;
  }

  const extension = extname(path);
  const directory = dirname(path);
  const name = basename(path, extension);
  let suffix = 2;
  while (true) {
    const candidate = join(directory, `${name}-${suffix}${extension}`);
    if (!fileExists(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}
