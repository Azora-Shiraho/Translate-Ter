import React, { useState } from 'react';
import { ArrowUpRight, CheckCircle2, Eye, EyeOff, Save } from 'lucide-react';
import { languageRegistry } from '@shared/languages';
import type { ProviderHealth } from '@shared/types';
import type { DerivedHealthState } from '../../app/types';

export function SettingsOverviewCard(props: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  detail: string;
  tone: string;
  featured?: boolean;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button
      className={`settingsSummaryCard settingsOverviewCard interactive tone-${props.tone}${props.featured ? ' featured' : ''}`}
      onClick={props.onClick}
      type="button"
    >
      <div className="settingsOverviewIcon">{props.icon}</div>
      <div>
        <span>{props.eyebrow}</span>
        <strong>{props.title}</strong>
        <p>{props.detail}</p>
      </div>
    </button>
  );
}

export function SettingsFactCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
  tone: string;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button className={`settingsSummaryCard settingsFactCard interactive tone-${props.tone}`} onClick={props.onClick} type="button">
      <div className="settingsFactIcon">{props.icon}</div>
      <div>
        <span>{props.label}</span>
        <strong>{props.value}</strong>
        {props.detail ? <small>{props.detail}</small> : null}
      </div>
    </button>
  );
}

export function InspectorSection(props: { icon: React.ReactNode; title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="inspectorSection">
      <div className="inspectorTitle">
        {props.icon}
        <strong>{props.title}</strong>
      </div>
      <div className="inspectorBody">{props.children}</div>
    </section>
  );
}

export function SectionTitle(props: { icon: React.ReactNode; title: string }): JSX.Element {
  return (
    <div className="sectionTitle">
      {props.icon}
      <strong>{props.title}</strong>
    </div>
  );
}

export function ProviderCard(props: {
  activeId: string;
  detail: string;
  health?: ProviderHealth;
  state: DerivedHealthState;
  loading?: boolean;
  actionDisabled?: boolean;
  actionLabel?: string;
  secondaryActionLabel?: string;
  secondaryActionDisabled?: boolean;
  secondaryActionLoading?: boolean;
  onTest: () => void;
  onSecondaryAction?: () => void;
  showMessage?: boolean;
}): JSX.Element {
  return (
    <div className={`providerCard tone-${props.state.tone}`}>
      <div className="providerCardHeader">
        <div>
          <span className={`signal ${props.state.tone}`} />
          <strong>{props.state.label}</strong>
          <small>{props.showMessage ? props.state.detail : props.detail}</small>
        </div>
        <div className="settingsActionRow">
          <button
            className="secondary compact settingsActionButton"
            disabled={props.loading || props.actionDisabled}
            onClick={props.onTest}
            type="button"
          >
            <CheckCircle2 size={16} />
            {props.loading ? props.actionLabel ?? '...' : props.actionLabel ?? 'Test'}
          </button>
          {props.secondaryActionLabel ? (
            <button
              className="secondary compact settingsActionButton"
              disabled={props.secondaryActionDisabled || props.secondaryActionLoading}
              onClick={props.onSecondaryAction}
              type="button"
            >
              <ArrowUpRight size={16} />
              {props.secondaryActionLabel}
            </button>
          ) : null}
        </div>
      </div>
      {props.health?.message ? <p>{props.health.message}</p> : null}
    </div>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  placeholder: string;
  type?: 'text' | 'password';
  revealable?: boolean;
  showToggleLabel: string;
  hideToggleLabel: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const inputType = props.revealable ? (revealed ? 'text' : props.type ?? 'password') : (props.type ?? 'text');
  return (
    <label>
      {props.label}
      <div className="textFieldControl textFieldShell">
        <input
          className="textFieldInput"
          type={inputType}
          value={props.value}
          placeholder={props.placeholder}
          onChange={(event) => props.onChange(event.target.value)}
        />
        {props.revealable ? (
          <button className="textFieldActionButton iconButton" onClick={() => setRevealed((current) => !current)} type="button">
            {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
            <span>{revealed ? props.hideToggleLabel : props.showToggleLabel}</span>
          </button>
        ) : null}
      </div>
    </label>
  );
}

export function NumberField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label>
      {props.label}
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function ToggleField(props: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label className="toggleField">
      <div>
        <strong>{props.label}</strong>
        <small>{props.detail}</small>
      </div>
      <input checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} type="checkbox" />
    </label>
  );
}

export function ProviderActionRow(props: {
  savingLabel: string;
  testingLabel: string;
  onSave: () => void;
  onTest: () => void;
  testDisabled?: boolean;
}): JSX.Element {
  return (
    <div className="settingsActionRow">
      <button className="secondary compact settingsActionButton" onClick={props.onSave} type="button">
        <Save size={16} />
        {props.savingLabel}
      </button>
      <button
        className="secondary compact settingsActionButton"
        disabled={props.testDisabled}
        onClick={props.onTest}
        type="button"
      >
        <CheckCircle2 size={16} />
        {props.testingLabel}
      </button>
    </div>
  );
}

export function SelectField(props: {
  label: string;
  uiLanguage: 'en-US' | 'zh-CN';
  value: string;
  targetOnly?: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const options = languageRegistry.filter((language) =>
    props.targetOnly ? language.supportsTranslationTarget : language.supportsAsr
  );

  return (
    <label>
      {props.label}
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {options.map((language) => (
          <option key={language.code} value={language.code}>
            {props.uiLanguage === 'zh-CN' ? language.nativeName : language.englishName}
          </option>
        ))}
      </select>
    </label>
  );
}
