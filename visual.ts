/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/* tslint:disable */

import {LitElement, css, html} from 'lit';
// Fix: Removed stale comment as the fix has been applied.
import {customElement, property, query} from 'lit/decorators.js';
import {Analyser} from './analyser';

@customElement('gdm-live-audio-visuals')
export class GdmLiveAudioVisuals extends LitElement {
  private inputAnalyser: Analyser;
  private outputAnalyser: Analyser;

  private _outputNode: AudioNode;
  @property()
  set outputNode(node: AudioNode) {
    this._outputNode = node;
    this.outputAnalyser = new Analyser(this._outputNode);
  }
  get outputNode() {
    return this._outputNode;
  }

  private _inputNode: AudioNode;
  @property()
  set inputNode(node: AudioNode) {
    this._inputNode = node;
    this.inputAnalyser = new Analyser(this._inputNode);
  }
  get inputNode() {
    return this._inputNode;
  }

  @property({type: Boolean}) isSpeaking = false;
  @property({type: Boolean}) isListening = false;

  // Fix: Removed stale comment as the fix has been applied.
  @query('canvas') private canvas: HTMLCanvasElement;
  private canvasCtx: CanvasRenderingContext2D;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      --brand-primary: #007aff;
      --brand-secondary: #34c759;
    }
    canvas {
      width: 100%;
      height: 100%;
      display: block;
    }
  `;

  private getAverage(dataArray: Uint8Array) {
    if (!dataArray || dataArray.length === 0) {
      return 0;
    }
    return (
      dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length
    );
  }

  private visualize() {
    requestAnimationFrame(() => this.visualize());

    if (!this.canvasCtx || !this.inputAnalyser || !this.outputAnalyser) {
      return;
    }

    this.inputAnalyser.update();
    this.outputAnalyser.update();

    const ctx = this.canvasCtx;
    const {width: w, height: h} = this.canvas;
    ctx.clearRect(0, 0, w, h);

    const inputAvg = this.getAverage(this.inputAnalyser.data);
    const outputAvg = this.getAverage(this.outputAnalyser.data);

    if (this.isListening) {
      this.drawListeningState(ctx, w, h, inputAvg);
    } else if (this.isSpeaking) {
      this.drawSpeakingState(ctx, w, h, outputAvg);
    } else {
      this.drawIdleState(ctx, w, h);
    }
  }

  private drawIdleState(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const y = h / 2;
    const time = performance.now() * 0.001;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.strokeStyle = 'rgba(0, 122, 255, 0.4)';
    ctx.lineWidth = 2;
    for (let x = 0; x < w; x++) {
      const wave = Math.sin(x * 0.02 + time) * 2;
      ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }

  private drawListeningState(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    avg: number,
  ) {
    const y = h / 2;
    const amp = Math.max(2, (avg / 255) * (h / 2) * 0.8);
    const time = performance.now() * 0.005;

    ctx.strokeStyle = 'var(--brand-secondary)';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'var(--brand-secondary)';
    ctx.shadowBlur = 5;

    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x < w; x++) {
      const wave = Math.sin(x * 0.04 + time) * amp;
      ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  private drawSpeakingState(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    avg: number,
  ) {
    const y = h / 2;
    const amp = Math.max(2, (avg / 255) * (h / 2) * 0.9);
    const time = performance.now() * 0.003;

    ctx.lineWidth = 2;
    ctx.shadowColor = 'var(--brand-primary)';
    ctx.shadowBlur = 8;

    const drawWave = (
      amplitude: number,
      frequency: number,
      phase: number,
      alpha: number,
    ) => {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(0, 122, 255, ${alpha})`;
      ctx.moveTo(0, y);
      for (let x = 0; x < w; x++) {
        const wave = Math.sin(x * frequency + phase) * amplitude;
        ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    };

    drawWave(amp, 0.03, time, 1.0);
    drawWave(amp * 0.6, 0.05, time * 1.5, 0.6);
    drawWave(amp * 0.3, 0.07, time * 0.8, 0.3);

    ctx.shadowBlur = 0;
  }

  // Fix: Removed stale comments as the fixes have been applied.
  protected firstUpdated() {
    this.canvasCtx = this.canvas.getContext('2d')!;

    const resizeObserver = new ResizeObserver(() => {
      const rect = (this as unknown as HTMLElement).getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.canvasCtx.scale(dpr, dpr);
    });
    resizeObserver.observe(this as unknown as HTMLElement);

    this.visualize();
  }

  protected render() {
    return html`<canvas></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-live-audio-visuals': GdmLiveAudioVisuals;
  }
}
