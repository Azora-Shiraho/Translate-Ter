import React from 'react';
import { ArrowUpRight, Download } from 'lucide-react';
import type { ExportVariant } from '@shared/types';

type ExportActionGroupProps = {
  title: string;
  labels: {
    translated: string;
    source: string;
    bilingual: string;
  };
  exportingVariant?: ExportVariant;
  disabled: {
    translated: boolean;
    source: boolean;
    bilingual: boolean;
  };
  onExport: (variant: ExportVariant) => void;
};

export function ExportActionGroup(props: ExportActionGroupProps): JSX.Element {
  return (
    <div className="exportActionGroup">
      <span>{props.title}</span>
      <div className="exportActions">
        <button className="exportButton" disabled={props.disabled.translated} onClick={() => props.onExport('translated')} type="button">
          {props.exportingVariant === 'translated' ? <Download size={14} className="spin" /> : <ArrowUpRight size={14} />}
          {props.labels.translated}
        </button>
        <button className="exportButton" disabled={props.disabled.source} onClick={() => props.onExport('source')} type="button">
          {props.exportingVariant === 'source' ? <Download size={14} className="spin" /> : <ArrowUpRight size={14} />}
          {props.labels.source}
        </button>
        <button className="exportButton" disabled={props.disabled.bilingual} onClick={() => props.onExport('bilingual')} type="button">
          {props.exportingVariant === 'bilingual' ? <Download size={14} className="spin" /> : <ArrowUpRight size={14} />}
          {props.labels.bilingual}
        </button>
      </div>
    </div>
  );
}
