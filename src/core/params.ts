// Parameter values: knob travel, snapping, defaults and how values are written out.

import type { FloatSpec, ModuleDef, ParamSpec } from './modules';
import { decodeShape } from './shape';
import type { Params, ParamValue } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Round to the parameter's step and keep it in range. */
export function snap(spec: FloatSpec, v: number): number {
  const stepped = spec.step ? Math.round(v / spec.step) * spec.step : v;
  return clamp(Number(stepped.toFixed(6)), spec.min, spec.max);
}

/** Knob position 0..1 of a value. */
export function toNorm(spec: FloatSpec, v: number): number {
  const x = clamp(v, spec.min, spec.max);
  const lin = (x - spec.min) / (spec.max - spec.min);
  if (spec.taper === 'log') return Math.log(x / spec.min) / Math.log(spec.max / spec.min);
  if (spec.taper === 'cube') return Math.cbrt(lin);
  return lin;
}

/** Value at knob position 0..1. */
export function fromNorm(spec: FloatSpec, t: number): number {
  const x = clamp(t, 0, 1);
  const span = spec.max - spec.min;
  if (spec.taper === 'log') return snap(spec, spec.min * (spec.max / spec.min) ** x);
  if (spec.taper === 'cube') return snap(spec, spec.min + span * x ** 3);
  return snap(spec, spec.min + span * x);
}

export function defaultParams(def: ModuleDef): Params {
  return Object.fromEntries(def.params.map((p) => [p.id, p.kind === 'sample' ? '' : p.def]));
}

/** A valid value for the parameter: the given one when it fits, clamped or replaced by the default otherwise. */
export function coerce(spec: ParamSpec, v: unknown): ParamValue {
  switch (spec.kind) {
    case 'float':
      return typeof v === 'number' && Number.isFinite(v) ? snap(spec, v) : spec.def;
    case 'choice':
      return spec.options.some(([value]) => value === v) ? (v as string) : spec.def;
    case 'bool':
      return typeof v === 'boolean' ? v : spec.def;
    case 'sample':
      return typeof v === 'string' ? v : '';
    case 'shape':
      return typeof v === 'string' && decodeShape(v) ? v : spec.def;
  }
}

const signed = (v: number, digits = 0) => (v > 0 ? '+' : '') + v.toFixed(digits);

function formatFloat(spec: FloatSpec, v: number): string {
  if (spec.off !== undefined && v <= spec.min) return spec.off;
  switch (spec.unit) {
    case 'Hz':
      // A slow rate reads better as the length of one cycle.
      if (v < 0.1) return `${(1 / v).toFixed(1 / v < 100 ? 1 : 0)} s`;
      if (v >= 10000) return `${(v / 1000).toFixed(1)} kHz`;
      if (v >= 1000) return `${(v / 1000).toFixed(2)} kHz`;
      return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} Hz`;
    case 's':
      if (v >= 1) return `${v.toFixed(2)} s`;
      return `${(v * 1000).toFixed(v < 0.01 ? 1 : 0)} ms`;
    case 'dB':
      return `${signed(v, 1)} dB`;
    case '%':
      return `${Math.round(v * 100)} %`;
    case 'st':
      return `${signed(v)} st`;
    case 'ct':
      return `${signed(v)} ct`;
    case 'oct':
      return `${signed(v)} oct`;
    case 'x':
      return `×${v.toFixed(2)}`;
    case ':1':
      return `${v.toFixed(v < 10 ? 1 : 0)}:1`;
    case 'pan': {
      const p = Math.round(v * 100);
      return p === 0 ? 'C' : p < 0 ? `L ${-p}` : `R ${p}`;
    }
    default:
      return spec.step && spec.step >= 1 ? v.toFixed(0) : v.toFixed(2);
  }
}

/** The value as shown next to a control. */
export function formatValue(spec: ParamSpec, v: ParamValue): string {
  switch (spec.kind) {
    case 'float':
      return formatFloat(spec, v as number);
    case 'choice':
      return spec.options.find(([value]) => value === v)?.[1] ?? String(v);
    case 'bool':
      return v ? 'On' : 'Off';
    case 'sample':
      return v ? String(v) : 'None';
    case 'shape':
      return 'Drawn';
  }
}

/** A modulation amount (-1..1) in the display unit of its target, e.g. "+36 st". */
export function formatAmount(target: FloatSpec, amount: number): string {
  if (!target.mod) return '';
  const v = amount * target.mod.span;
  // A wide span reads in whole units, except below one, where vibrato and drift of the pitch live.
  const digits = Math.abs(target.mod.span) >= 20 && (v === 0 || Math.abs(v) >= 1) ? 0 : 1;
  return `${signed(v, digits)}${target.mod.unit ? ' ' + target.mod.unit : ''}`;
}
