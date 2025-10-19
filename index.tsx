// Fix: Corrected invalid tslint comment syntax.
/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  FunctionDeclaration,
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  Session,
  Type,
} from '@google/genai';
import {jsPDF} from 'jspdf';
import {LitElement, css, html, nothing} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual';

interface TranscriptionHistory {
  role: 'user' | 'model';
  text: string;
}

const QUICK_STYLES = [
  {
    name: 'Modern',
    prompt:
      'Transform this kitchen into a sleek, modern style. Use flat-panel cabinets, minimalist metal hardware, clean quartz countertops, a simple geometric backsplash, and integrated stainless steel appliances. The color palette should be neutral and sophisticated.',
  },
  {
    name: 'Farmhouse',
    prompt:
      'Give this kitchen a cozy farmhouse makeover. It should feature white shaker-style cabinets, a large apron-front sink, warm butcher block countertops, a classic white subway tile backsplash, and rustic open shelving with natural wood accents.',
  },
  {
    name: 'Industrial',
    prompt:
      'Remodel this kitchen with a cool, industrial vibe. Incorporate elements like exposed brick, open shelving made from dark wood and metal pipes, polished concrete countertops, stainless steel appliances, and hanging Edison bulb pendant lights.',
  },
  {
    name: 'Scandinavian',
    prompt:
      'Redesign this kitchen with a bright and airy Scandinavian aesthetic. Use light-colored wood or white handleless cabinets, minimalist decor, light-colored countertops, a simple tile backsplash, and maximize natural light for a clean, uncluttered feel.',
  },
  {
    name: 'Coastal',
    prompt:
      'Create a breezy, coastal-style kitchen. Use a color palette of whites, soft blues, and sandy beiges. Feature white or light-colored cabinets, light quartz or granite countertops, a shimmering backsplash like mother-of-pearl tiles, and natural textures.',
  },
  {
    name: 'Traditional',
    prompt:
      'Redesign this kitchen in an elegant, traditional style. Use detailed, raised-panel cabinets in a classic color like cream or cherry wood, ornate hardware, natural stone countertops like granite or marble, a decorative tile backsplash, and classic, timeless light fixtures.',
  },
];

@customElement('gdm-remodel-widget')
export class GdmRemodelWidget extends LitElement {
  // Component State
  @state() isRecording = false;
  @state() isSpeaking = false;
  @state() error = '';
  @state() private isStartingConversation = false;
  @state() private remodelImage: string | null = null;
  @state() private generatedImageHistory: string[] = [];
  @state() private activeImageIndex: number | null = null;
  @state() private isRemodeling = false;
  @state() private remodelTranscriptionHistory: TranscriptionHistory[] = [];
  @state() private showCameraModal = false;
  @state() private isWidescreen = window.innerWidth >= 992;

  // Component Properties
  @property({type: String}) agentName = 'Virtual Assistant';
  @property({type: String, attribute: 'placeholder-title'})
  placeholderTitle = 'Virtual Assistant';
  @property({type: String, attribute: 'placeholder-description'})
  placeholderDescription =
    'Click the microphone below to start our conversation.';
  @property({type: String})
  avatar = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white' width='24px' height='24px'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E`;
  @property({type: String, attribute: 'placeholder-avatar'})
  placeholderAvatar = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white' width='48px' height='48px'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E`;

  @state() private currentInputTranscription = '';
  @state() private currentOutputTranscription = '';
  private outputTranscriptionComplete = false;
  private speechTimeout: number;
  private client: GoogleGenAI;
  private sessionPromise: Promise<Session> | null = null;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: MediaStreamAudioSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();
  private resizeObserver: ResizeObserver;

  @query('#camera-video') private videoElement: HTMLVideoElement;
  @query('#camera-canvas') private canvasElement: HTMLCanvasElement;
  @query('#image-upload-input') private imageUploadInput: HTMLInputElement;

  static styles = css`
    :host {
      --brand-primary: #007aff;
      --brand-secondary: #34c759;
      --background-color: #ffffff;
      --text-primary: #1d1d1f;
      --text-secondary: #6e6e73;
      --user-bubble-background: #e9e9eb;
      --model-bubble-background: var(--brand-primary);
      --model-bubble-text: #ffffff;
      --border-radius: 24px;
      --font-family: 'Inter', sans-serif;
      --font-headline: 'Poppins', sans-serif;
      --border-color: #eaecef;
    }
    .widget {
      background: var(--background-color);
      border-radius: var(--border-radius);
      display: flex;
      font-family: var(--font-family);
      position: relative; /* Anchor for the modal */
    }

    /* Mobile Styles */
    .widget-mobile {
      width: 400px;
      max-width: 100%;
      height: 700px;
      flex-direction: column;
      overflow: hidden;
    }

    /* Widescreen Styles */
    .widget-widescreen {
      width: 100%;
      height: 700px;
      flex-direction: row;
    }
    .remodel-widescreen-sidebar {
      flex: 1;
      max-width: 320px;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--border-color);
      background-color: #f9f9fb;
      padding: 20px;
      gap: 20px;
    }
    .remodel-widescreen-sidebar .remodel-image-wrapper {
      flex-grow: 1;
      min-height: 0;
    }
    .remodel-widescreen-sidebar .remodel-image-wrapper img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .remodel-widescreen-sidebar .controls-container {
      flex-shrink: 0;
    }

    .remodel-widescreen-main {
      flex: 3;
      display: flex;
      padding: 20px;
      position: relative;
      min-width: 0; /* Prevents flex item from overflowing */
    }
    .new-design-container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .latest-image-wrapper {
      flex-grow: 1;
      min-height: 0;
      position: relative;
      border-radius: var(--border-radius);
      overflow: hidden;
      background-color: #f0f2f5;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .latest-image-wrapper img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .latest-image-wrapper .label,
    .remodel-widescreen-main .remodel-image-wrapper .label {
      position: absolute;
      top: 8px;
      left: 8px;
      background: rgba(0, 0, 0, 0.5);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      z-index: 1;
    }
    .latest-image-wrapper .generated-image-placeholder {
      height: 100%;
    }

    .widescreen-uploader-wrapper {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .header {
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }
    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background-color: var(--brand-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      background-size: 24px 24px;
      background-position: center;
      background-repeat: no-repeat;
    }
    .agent-info {
      display: flex;
      flex-direction: column;
    }
    .agent-name {
      font-weight: 700;
      font-size: 16px;
      color: var(--text-primary);
    }
    .agent-status {
      font-size: 13px;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .agent-status::before {
      content: '';
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--brand-secondary);
    }
    .visualizer {
      flex-grow: 1;
      height: 56px;
    }
    .chat-container {
      flex: 1;
      padding: 20px 20px 0 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .chat-bubble {
      max-width: 80%;
      padding: 10px 15px;
      border-radius: 18px;
      margin-bottom: 10px;
      font-size: 15px;
      line-height: 1.4;
    }
    .chat-bubble.user {
      background-color: var(--user-bubble-background);
      color: var(--text-primary);
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .chat-bubble.model {
      background-color: var(--model-bubble-background);
      color: var(--model-bubble-text);
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    .controls-container {
      padding: 10px 20px 20px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
    .remodel-widescreen-sidebar .controls-container {
      padding: 0;
    }
    .controls {
      display: flex;
      align-items: center;
      width: 100%;
      gap: 12px;
      padding: 6px;
      border: 3px solid var(--user-bubble-background);
      border-radius: 34px;
    }
    .mic-button {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.2s ease, box-shadow 0.2s ease;
      background-color: var(--brand-primary);
      box-shadow: 0 2px 8px rgba(0, 122, 255, 0.3);
      flex-shrink: 0;
    }
    .mic-button:disabled {
      background-color: #a0c3e6;
      cursor: not-allowed;
      box-shadow: none;
    }
    .mic-button.end-call {
      background-color: #f86262;
      box-shadow: 0 2px 8px rgba(255, 0, 0, 0.3);
    }
    .transcription-preview {
      font-size: 14px;
      color: var(--text-secondary);
      height: 20px;
      font-style: italic;
      text-align: center;
    }
    .modal-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      animation: fadeIn 0.3s;
    }
    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    .modal-content {
      background: white;
      padding: 24px;
      border-radius: 16px;
      width: 90%;
      max-width: 500px;
      max-height: 80%;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    }
    .tab-container {
      flex: 1;
      padding: 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .image-dropzone {
      border: 2px dashed #d9d9e3;
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      color: var(--text-secondary);
      cursor: pointer;
      position: relative;
      background: #f7f7f8;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 200px;
      flex-grow: 1; /* For widescreen */
    }
    .image-preview {
      max-width: 100%;
      max-height: 200px;
      border-radius: 8px;
      margin-bottom: 12px;
    }
    .image-actions {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-top: 12px;
    }
    .action-btn {
      background: #e9e9eb;
      color: var(--text-primary);
      border: none;
      padding: 10px 16px;
      border-radius: 8px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: background-color 0.2s;
    }
    .action-btn:hover {
      background-color: #dcdce0;
    }
    .action-btn.secondary {
      background-color: transparent;
      border: 1px solid var(--border-color);
      width: 100%;
      justify-content: center;
    }
    .action-btn.secondary:hover {
      background-color: #f7f7f8;
    }
    #image-upload-input {
      display: none;
    }
    .remodel-design-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .remodel-images-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      padding: 12px 20px 0;
    }
    .remodel-image-wrapper {
      border-radius: 8px;
      overflow: hidden;
      position: relative;
      background: #f0f2f5;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .remodel-image-wrapper img {
      width: 100%;
      height: 150px;
      object-fit: cover;
      display: block;
    }
    .remodel-image-wrapper .label {
      position: absolute;
      top: 8px;
      left: 8px;
      background: rgba(0, 0, 0, 0.5);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
    }
    .remodel-actions {
      margin: 10px 20px 0;
    }
    .remodel-widescreen-sidebar .remodel-actions {
      margin: 12px 0 0;
      padding: 0;
    }
    .generated-image-placeholder {
      width: 100%;
      height: 100%;
      min-height: 150px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-secondary);
      flex-direction: column;
      gap: 8px;
      background: #f0f2f5;
    }
    .remodel-design-view .chat-container {
      padding-top: 10px;
    }

    /* Gallery Styles */
    .gallery-container {
      flex-shrink: 0;
      padding: 10px;
      background-color: #f9f9fb;
      border-radius: 12px;
    }
    .remodel-design-view .gallery-container {
      padding: 10px 20px 10px;
      background-color: transparent;
    }
    .gallery-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 8px;
      padding: 0 2px;
      text-transform: uppercase;
    }
    .gallery-scroll {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      padding-bottom: 5px; /* for scrollbar */
    }
    .gallery-scroll::-webkit-scrollbar {
      height: 6px;
    }
    .gallery-scroll::-webkit-scrollbar-thumb {
      background-color: #d9d9e3;
      border-radius: 3px;
    }
    .gallery-thumbnail {
      width: 70px;
      height: 70px;
      object-fit: cover;
      border-radius: 6px;
      border: 3px solid transparent;
      transition: border-color 0.2s;
      flex-shrink: 0;
      cursor: pointer;
    }
    .gallery-thumbnail:hover {
      border-color: rgba(0, 122, 255, 0.5);
    }
    .remodel-design-view .gallery-thumbnail {
      width: 60px;
      height: 60px;
    }
    .gallery-thumbnail.active {
      border-color: var(--brand-primary);
      box-shadow: 0 0 8px rgba(0, 122, 255, 0.3);
    }

    /* Quick Styles */
    .quick-styles-container {
      padding: 10px;
      border-radius: 12px;
      background-color: #f0f2f5;
    }
    .remodel-design-view .quick-styles-container {
      margin: 10px 20px 0;
      padding: 12px;
    }
    .quick-styles-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 10px;
      padding: 0 2px;
      text-transform: uppercase;
    }
    .quick-styles-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
      gap: 8px;
    }
    .quick-style-btn {
      background-color: #ffffff;
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s, box-shadow 0.2s, transform 0.2s;
    }
    .quick-style-btn:hover {
      background-color: #f7f7f8;
      transform: translateY(-1px);
    }
    .quick-style-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .camera-modal-content {
      padding: 10px;
      max-width: 95%;
    }
    .camera-modal-content video {
      width: 100%;
      border-radius: 8px;
    }
    .modal-footer {
      padding-top: 16px;
      margin-top: 16px;
      border-top: 1px solid #e9e9eb;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }
    .download-button {
      background-color: var(--brand-primary);
      color: white;
      border: none;
      padding: 10px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
    }
  `;

  constructor() {
    super();
    this.initAudio();
    this.client = new GoogleGenAI({apiKey: process.env.API_KEY});
    this.outputNode.connect(this.outputAudioContext.destination);
  }

  connectedCallback() {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver(() => {
      const isWidescreenNow = window.innerWidth >= 992;
      if (isWidescreenNow !== this.isWidescreen) {
        this.isWidescreen = isWidescreenNow;
      }
    });
    this.resizeObserver.observe(this as unknown as Element);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver.disconnect();
  }

  protected updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has('showCameraModal')) {
      if (this.showCameraModal) {
        this.startVideoStream();
      } else {
        this.stopVideoStream();
      }
    }
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private initSession() {
    const instruction = `You are an expert kitchen designer AI. The user has uploaded a photo of their current kitchen. Your goal is to have a conversation with them about their desired changes.
      1. First, help them generate an initial new design. When you have a clear idea of what they want (e.g., 'a modern style with white cabinets'), use the 'generate_kitchen_design' tool with a detailed description.
      2. After a new design is generated, the user might ask for further edits (e.g., 'now change the countertop to black marble').
      3. For these follow-up requests, use the 'generate_kitchen_design' tool again to apply the edits. The system will automatically use the most recent design for the edit.
      4. After the tool call is successful, DO NOT provide a verbal confirmation. The user will see the image update on their screen. Wait silently for their next command.`;
    const tools: FunctionDeclaration[] = [
      {
        name: 'generate_kitchen_design',
        description:
          'Generates a new kitchen design image based on the user-provided photo and a text description of the desired changes.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            description: {
              type: Type.STRING,
              description:
                'A detailed prompt describing the desired kitchen style, colors, materials, and layout changes. For example: "A modern kitchen with white shaker cabinets, a navy blue island with a waterfall marble countertop, and gold hardware."',
            },
          },
          required: ['description'],
        },
      },
    ];

    try {
      this.sessionPromise = this.client.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {},
          onmessage: async (message: LiveServerMessage) => {
            clearTimeout(this.speechTimeout);
            this.speechTimeout = window.setTimeout(() => {
              this.isSpeaking = false;
            }, 1000);

            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;
            if (audio) {
              this.isSpeaking = true;
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );
              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });
              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              if (this.outputTranscriptionComplete) {
                this.currentOutputTranscription = text;
                this.outputTranscriptionComplete = false;
              } else {
                this.currentOutputTranscription += text;
              }
            } else if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              this.currentInputTranscription += text;
            }

            if (message.serverContent?.turnComplete) {
              const newEntries: TranscriptionHistory[] = [];
              if (this.currentInputTranscription.trim()) {
                newEntries.push({
                  role: 'user',
                  text: this.currentInputTranscription,
                });
              }
              if (this.currentOutputTranscription.trim()) {
                newEntries.push({
                  role: 'model',
                  text: this.currentOutputTranscription,
                });
              }

              if (newEntries.length > 0) {
                this.remodelTranscriptionHistory = [
                  ...this.remodelTranscriptionHistory,
                  ...newEntries,
                ];
              }

              this.currentInputTranscription = '';
              this.currentOutputTranscription = '';
              this.outputTranscriptionComplete = true;
            }

            if (message.toolCall) {
              const functionResponses = await Promise.all(
                message.toolCall.functionCalls.map(async (fc) => {
                  let result = 'Error: Unknown function call.';
                  if (fc.name === 'generate_kitchen_design') {
                    result = await this.handleGenerateKitchenDesign(
                      fc.args.description as string,
                    );
                  }
                  return {
                    id: fc.id,
                    name: fc.name,
                    response: {result},
                  };
                }),
              );

              try {
                const session = await this.sessionPromise;
                if (session) {
                  session.sendToolResponse({functionResponses});
                }
              } catch (e) {
                this.error = 'Error communicating with the assistant.';
              }
            }

            if (message.serverContent?.interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.error = e.message;
          },
          onclose: (e: CloseEvent) => {},
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
          },
          systemInstruction: instruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{functionDeclarations: tools}],
        },
      });
    } catch (e) {
      this.error = e.message;
      console.error(e);
      throw e;
    }
  }

  private async _startMicrophoneStream() {
    if (this.isRecording) return;
    this.inputAudioContext.resume();

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        4096,
        1,
        1,
      );
      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording || !this.sessionPromise) return;
        const pcmData = audioProcessingEvent.inputBuffer.getChannelData(0);
        this.sessionPromise.then((session) => {
          session.sendRealtimeInput({media: createBlob(pcmData)});
        });
      };
      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);
      this.isRecording = true;
    } catch (err) {
      this.error = `Error starting recording: ${err.message}`;
      console.error('Error starting recording:', err);
      this.stopRecording();
    } finally {
      this.isStartingConversation = false;
    }
  }

  private async startRecording() {
    if (this.isRecording || this.isStartingConversation) return;

    this.isStartingConversation = true;
    this.error = '';

    try {
      this.initSession();
      await this.sessionPromise;

      const greetingText = `Great, let's design your new kitchen! What style are you thinking of? For example, you can say 'make it modern' or 'I'd like to see it with a farmhouse sink'.`;
      this.remodelTranscriptionHistory = [{role: 'model', text: greetingText}];

      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{parts: [{text: greetingText}]}],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
          },
        },
      });

      const audioData =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioData) {
        throw new Error('API did not return audio for the initial greeting.');
      }

      this.isSpeaking = true;

      const audioBuffer = await decodeAudioData(
        decode(audioData),
        this.outputAudioContext,
        24000,
        1,
      );

      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputNode);
      source.onended = () => {
        this._startMicrophoneStream();
      };
      source.start();

      this.speechTimeout = window.setTimeout(() => {
        this.isSpeaking = false;
      }, audioBuffer.duration * 1000 + 200);
    } catch (err) {
      this.error = `Error starting conversation: ${err.message}`;
      console.error(err);
      this.isStartingConversation = false;
      this.sessionPromise = null;
    }
  }

  private stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
      this.scriptProcessorNode = null;
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  private async endConversation() {
    this.stopRecording();
    if (this.sessionPromise) {
      try {
        const session = await this.sessionPromise;
        session.close();
      } catch (e) {
        console.error('Error closing session:', e);
        this.error = 'Error ending conversation.';
      }
    }
    this.sessionPromise = null;
    this.currentInputTranscription = '';
    this.currentOutputTranscription = '';
  }

  private toggleRecording() {
    if (this.isRecording || this.isStartingConversation) {
      this.endConversation();
    } else {
      this.startRecording();
    }
  }

  private handleImageUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        this.remodelImage = event.target?.result as string;
        this.toggleRecording();
      };
      reader.readAsDataURL(input.files[0]);
    }
  }

  private async startVideoStream() {
    try {
      if (!this.videoElement) {
        await (this as any).updateComplete;
      }
      const stream = await navigator.mediaDevices.getUserMedia({video: true});
      this.videoElement.srcObject = stream;
    } catch (err) {
      this.error = 'Could not access camera.';
      this.showCameraModal = false;
    }
  }

  private stopVideoStream() {
    if (this.videoElement && this.videoElement.srcObject) {
      const stream = this.videoElement.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      this.videoElement.srcObject = null;
    }
  }

  private handleCapturePhoto() {
    if (!this.videoElement) return;
    const context = this.canvasElement.getContext('2d');
    this.canvasElement.width = this.videoElement.videoWidth;
    this.canvasElement.height = this.videoElement.videoHeight;
    context?.drawImage(
      this.videoElement,
      0,
      0,
      this.videoElement.videoWidth,
      this.videoElement.videoHeight,
    );
    this.remodelImage = this.canvasElement.toDataURL('image/jpeg');
    this.toggleRecording();
    this.showCameraModal = false;
  }

  private handleQuickStyleClick(prompt: string) {
    if (this.isRemodeling || !this.remodelImage) return;
    this.handleGenerateKitchenDesign(prompt);
  }

  private async handleGenerateKitchenDesign(prompt: string) {
    const baseImage =
      this.activeImageIndex !== null
        ? this.generatedImageHistory[this.activeImageIndex]
        : this.remodelImage;

    if (!baseImage) {
      this.error = 'Cannot generate design without a base image.';
      return 'Error: No base image was provided to generate a design from.';
    }

    this.isRemodeling = true;
    this.error = '';
    try {
      const base64Data = baseImage.split(',')[1];
      const mimeType = baseImage.match(/data:(.*);/)?.[1];
      if (!base64Data || !mimeType) {
        throw new Error('Invalid image format.');
      }

      const imagePart = {inlineData: {data: base64Data, mimeType}};
      const textPart = {
        text: `Apply the following style to the user's kitchen image, preserving the original layout: ${prompt}`,
      };

      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {parts: [imagePart, textPart]},
        config: {
          responseModalities: [Modality.IMAGE],
        },
      });

      let newImageGenerated = false;
      if (response.candidates && response.candidates.length > 0) {
        const imagePart = response.candidates[0].content.parts.find(
          (p) => p.inlineData && p.inlineData.data,
        );
        if (imagePart && imagePart.inlineData) {
          const newImageSrc = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
          this.generatedImageHistory = [
            ...this.generatedImageHistory,
            newImageSrc,
          ];
          this.activeImageIndex = this.generatedImageHistory.length - 1;
          newImageGenerated = true;
        }
      }

      if (newImageGenerated) {
        return 'Success, the new kitchen design has been generated and is now displayed.';
      } else {
        this.error = 'The model did not return a valid image.';
        return 'Error: The design could not be generated. The model did not return an image.';
      }
    } catch (err) {
      this.error = `Image generation failed: ${err.message}`;
      console.error('Image generation error:', err);
      return `Error: Image generation failed. ${err.message}`;
    } finally {
      this.isRemodeling = false;
    }
  }

  private handleThumbnailClick(index: number) {
    this.activeImageIndex = index;
  }

  private resetState() {
    this.endConversation();
    this.remodelImage = null;
    this.generatedImageHistory = [];
    this.activeImageIndex = null;
    this.isRemodeling = false;
    this.remodelTranscriptionHistory = [];
    this.showCameraModal = false;
    this.error = '';
  }

  renderControls() {
    const isMicActive = this.isRecording || this.isStartingConversation;
    return html`
      <div class="controls-container">
        <div class="controls">
          <button
            class="mic-button ${isMicActive ? 'end-call' : ''}"
            @click=${this.toggleRecording}
            ?disabled=${this.isStartingConversation || this.isRemodeling}
          >
            ${
              this.isStartingConversation || this.isRemodeling
                ? html`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 9.24 20.84 6.78 18.95 5.05" stroke="white" stroke-width="4" stroke-linecap="round"/></svg>`
                : isMicActive
                ? html`<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 2c1.1 0 2 .9 2 2v4.73l-6-6C8.48 2.24 9.19 2 10 2c.35 0 .68.06 1 .16L12 2zM3.72 2.3L2.31 3.72 6.07 7.47C6.02 7.63 6 7.81 6 8H4c0 .43.06.85.17 1.25L2.38 7.46C2.15 8.26 2 9.11 2 10h2c0-.59.08-1.16.22-1.7L7 11v1c0 2.21 1.79 4 4 4 .71 0 1.36-.19 1.93-.52l2.65 2.65c-1.13.78-2.45 1.27-3.91 1.32V22h-2v-2.02c-2.85-.43-5-2.91-5-5.98H5c0 .48.05.95.14 1.4L8.29 13.3c-.2-.43-.29-.9-.29-1.39V8l-3.29-3.29L3.72 2.3z m16.1 11.23c.1-.41.18-.83.18-1.25h-2c0 .28-.03.55-.08.81l1.72 1.72c.08-.44.16-.88.16-1.35h2c0 1.1-.21 2.14-.59 3.08l-1.61-1.61zM18 8h-2c0 1.3-.54 2.47-1.38 3.34l1.43 1.43C17.18 11.8 18 10.01 18 8z"/></svg>`
                : html`<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.42 2.58 2.66 4.54 5.21 4.81V21h-2c-.55 0-1 .45-1 1s.45 1 1 1h6c.55 0 1-.45 1-1s-.45-1-1-1h-2v-3.05c2.54-.27 4.79-2.23 5.21-4.81.09-.6-.39-1.14-1-1.14z"/></svg>`
            }
          </button>
          <gdm-live-audio-visuals
            class="visualizer"
            .inputNode=${this.inputNode}
            .outputNode=${this.outputNode}
            ?isListening=${this.isRecording}
            ?isSpeaking=${this.isSpeaking}
          >
          </gdm-live-audio-visuals>
          <div style="width: 40px; height: 40px;"></div>
        </div>
        <div class="transcription-preview">
          ${
            this.isRemodeling
              ? 'Generating your new kitchen design...'
              : this.isRecording
              ? this.currentInputTranscription
              : this.isSpeaking
              ? this.currentOutputTranscription
              : this.error
              ? html`<span style="color: red;">${this.error}</span>`
              : ''
          }
        </div>
      </div>
    `;
  }

  renderChatHistory() {
    return html`${this.remodelTranscriptionHistory.map(
      (entry) => html`
        <div class="chat-bubble ${entry.role}">
          ${unsafeHTML(entry.text.replace(/\n/g, '<br>'))}
        </div>
      `,
    )}`;
  }

  // Renders the initial view for image upload
  renderImageUploadView() {
    return html`
      <div class="tab-container">
        <input
          type="file"
          id="image-upload-input"
          accept="image/*"
          @change=${this.handleImageUpload}
        />
        <div
          class="image-dropzone"
          @click=${() => this.imageUploadInput?.click()}
        >
          <p>${this.placeholderDescription}</p>
          <div class="image-actions">
            <button
              class="action-btn"
              @click=${(e: Event) => {
                e.stopPropagation();
                this.imageUploadInput?.click();
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload
            </button>
            <button class="action-btn" @click=${(e: Event) => {
              e.stopPropagation();
              this.showCameraModal = true;
            }}>
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Take Photo
            </button>
          </div>
        </div>
      </div>
    `;
  }

  renderCameraModal() {
    return html`
      <div class="modal-overlay" @click=${() => (this.showCameraModal = false)}>
         <div class="modal-content camera-modal-content" @click=${(e: Event) =>
           e.stopPropagation()}>
           <video id="camera-video" autoplay playsinline></video>
           <canvas id="camera-canvas" style="display:none;"></canvas>
           <div class="modal-footer">
             <button class="download-button" @click=${
               this.handleCapturePhoto
             }>Capture Photo</button>
           </div>
         </div>
      </div>
    `;
  }

  renderQuickStyles() {
    return html`
      <div class="quick-styles-container">
        <div class="quick-styles-title">Quick Styles</div>
        <div class="quick-styles-grid">
          ${QUICK_STYLES.map(
            (style) => html`
              <button
                class="quick-style-btn"
                @click=${() => this.handleQuickStyleClick(style.prompt)}
                ?disabled=${this.isRemodeling}
              >
                ${style.name}
              </button>
            `,
          )}
        </div>
      </div>
    `;
  }

  // --- MOBILE RENDERING ---
  renderMobile() {
    return html`
      <div class="widget widget-mobile">
        <div class="header">
          <div
            class="avatar"
            style="background-image: url('${this.avatar}')"
          ></div>
          <div class="agent-info">
            <div class="agent-name">${this.agentName}</div>
            <div class="agent-status">Online</div>
          </div>
        </div>
        ${
          this.remodelImage
            ? this.renderMobileConversationView()
            : this.renderImageUploadView()
        }
        ${this.showCameraModal ? this.renderCameraModal() : nothing}
      </div>
    `;
  }

  renderMobileConversationView() {
    return html`
      <div class="remodel-design-view">
        <div class="remodel-images-container">
          <div class="remodel-image-wrapper">
            <img src=${this.remodelImage} alt="Original kitchen" />
            <div class="label">Original</div>
          </div>
          <div class="remodel-image-wrapper">
            ${this.renderGeneratedImage()}
            <div class="label">New Design</div>
          </div>
        </div>
        <div class="remodel-actions">
          <button class="action-btn secondary" @click=${this.resetState}>Start New</button>
        </div>
        ${this.renderQuickStyles()}
        ${
          this.generatedImageHistory.length > 0
            ? this.renderImageGallery()
            : nothing
        }
        <div class="chat-container">${this.renderChatHistory()}</div>
      </div>
      ${this.renderControls()}
    `;
  }

  // --- WIDESCREEN RENDERING ---
  renderWidescreen() {
    return html`
       <div class="widget widget-widescreen">
          ${
            this.remodelImage
              ? this.renderWidescreenConversationView()
              : html`<div class="widescreen-uploader-wrapper">${this.renderImageUploadView()}</div>`
          }
          ${this.showCameraModal ? this.renderCameraModal() : nothing}
      </div>
    `;
  }

  renderWidescreenConversationView() {
    return html`
      <div class="remodel-widescreen-sidebar">
        <div class="remodel-image-wrapper">
          <img src=${this.remodelImage} alt="Original kitchen" />
          <div class="label">Original</div>
        </div>
        <div class="remodel-actions">
           <button class="action-btn secondary" @click=${this.resetState}>Start New Project</button>
        </div>
        ${this.renderQuickStyles()} ${this.renderControls()}
      </div>
      <div class="remodel-widescreen-main">
        <div class="new-design-container">
          <div class="latest-image-wrapper">
            ${this.renderGeneratedImage()}
            <div class="label">New Design</div>
          </div>
          ${
            this.generatedImageHistory.length > 0
              ? this.renderImageGallery()
              : nothing
          }
        </div>
      </div>
    `;
  }

  renderGeneratedImage() {
    const activeImage =
      this.activeImageIndex !== null
        ? this.generatedImageHistory[this.activeImageIndex]
        : null;

    return activeImage
      ? html`<img src=${activeImage} alt="New kitchen design" />`
      : html`<div class="generated-image-placeholder">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.898 20.572L16.25 21.75l-.648-1.178a3.375 3.375 0 00-2.455-2.456L12 17.25l1.178-.648a3.375 3.375 0 002.455-2.456L16.25 13.5l.648 1.178a3.375 3.375 0 002.456 2.456L20.25 18l-1.178.648a3.375 3.375 0 00-2.456 2.456z"
            />
          </svg>
          <span>New Design</span>
        </div>`;
  }

  renderImageGallery() {
    return html`
      <div class="gallery-container">
        <div class="gallery-title">Design History</div>
        <div class="gallery-scroll">
          ${this.generatedImageHistory.map(
            (imgSrc, index) => html`
              <img
                src=${imgSrc}
                class="gallery-thumbnail ${index === this.activeImageIndex
                  ? 'active'
                  : ''}"
                alt="Design iteration ${index + 1}"
                @click=${() => this.handleThumbnailClick(index)}
              />
            `,
          )}
        </div>
      </div>
    `;
  }

  // --- MAIN RENDER ---
  render() {
    return this.isWidescreen ? this.renderWidescreen() : this.renderMobile();
  }
}

@customElement('gdm-room-remodel-widget')
export class GdmRoomRemodelWidget extends LitElement {
  // Component State
  @state() isRecording = false;
  @state() isSpeaking = false;
  @state() error = '';
  @state() private isStartingConversation = false;
  @state() private remodelImage: string | null = null;
  @state() private generatedImageHistory: string[] = [];
  @state() private activeImageIndex: number | null = null;
  @state() private isRemodeling = false;
  @state() private remodelTranscriptionHistory: TranscriptionHistory[] = [];
  @state() private showCameraModal = false;
  @state() private isWidescreen = window.innerWidth >= 992;

  // Component Properties
  @property({type: String}) agentName = 'Virtual Assistant';
  @property({type: String, attribute: 'placeholder-title'})
  placeholderTitle = 'Virtual Assistant';
  @property({type: String, attribute: 'placeholder-description'})
  placeholderDescription =
    'Click the microphone below to start our conversation.';
  @property({type: String})
  avatar = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white' width='24px' height='24px'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E`;
  @property({type: String, attribute: 'placeholder-avatar'})
  placeholderAvatar = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white' width='48px' height='48px'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E`;

  @state() private currentInputTranscription = '';
  @state() private currentOutputTranscription = '';
  private outputTranscriptionComplete = false;
  private speechTimeout: number;
  private client: GoogleGenAI;
  private sessionPromise: Promise<Session> | null = null;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: MediaStreamAudioSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();
  private resizeObserver: ResizeObserver;

  @query('#camera-video') private videoElement: HTMLVideoElement;
  @query('#camera-canvas') private canvasElement: HTMLCanvasElement;
  @query('#image-upload-input') private imageUploadInput: HTMLInputElement;

  static styles = GdmRemodelWidget.styles;

  constructor() {
    super();
    this.initAudio();
    this.client = new GoogleGenAI({apiKey: process.env.API_KEY});
    this.outputNode.connect(this.outputAudioContext.destination);
  }

  connectedCallback() {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver(() => {
      const isWidescreenNow = window.innerWidth >= 992;
      if (isWidescreenNow !== this.isWidescreen) {
        this.isWidescreen = isWidescreenNow;
      }
    });
    this.resizeObserver.observe(this as unknown as Element);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver.disconnect();
  }

  protected updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has('showCameraModal')) {
      if (this.showCameraModal) {
        this.startVideoStream();
      } else {
        this.stopVideoStream();
      }
    }
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private initSession() {
    const instruction = `You are an expert interior designer AI. The user has uploaded a photo of their current room. Your goal is to have a conversation with them about their desired changes.
      1. First, help them generate an initial new design. When you have a clear idea of what they want (e.g., 'a modern living room with a sectional sofa'), use the 'generate_room_design' tool with a detailed description.
      2. After a new design is generated, the user might ask for further edits (e.g., 'now change the wall color to light blue').
      3. For these follow-up requests, use the 'generate_room_design' tool again to apply the edits. The system will automatically use the most recent design for the edit.
      4. After the tool call is successful, DO NOT provide a verbal confirmation. The user will see the image update on their screen. Wait silently for their next command.`;
    const tools: FunctionDeclaration[] = [
      {
        name: 'generate_room_design',
        description:
          'Generates a new room design image based on the user-provided photo and a text description of the desired changes.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            description: {
              type: Type.STRING,
              description:
                'A detailed prompt describing the desired room style, colors, materials, and layout changes. For example: "A modern living room with a gray sectional sofa, minimalist art, and a large area rug."',
            },
          },
          required: ['description'],
        },
      },
    ];

    try {
      this.sessionPromise = this.client.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {},
          onmessage: async (message: LiveServerMessage) => {
            clearTimeout(this.speechTimeout);
            this.speechTimeout = window.setTimeout(() => {
              this.isSpeaking = false;
            }, 1000);

            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;
            if (audio) {
              this.isSpeaking = true;
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );
              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });
              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              if (this.outputTranscriptionComplete) {
                this.currentOutputTranscription = text;
                this.outputTranscriptionComplete = false;
              } else {
                this.currentOutputTranscription += text;
              }
            } else if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              this.currentInputTranscription += text;
            }

            if (message.serverContent?.turnComplete) {
              const newEntries: TranscriptionHistory[] = [];
              if (this.currentInputTranscription.trim()) {
                newEntries.push({
                  role: 'user',
                  text: this.currentInputTranscription,
                });
              }
              if (this.currentOutputTranscription.trim()) {
                newEntries.push({
                  role: 'model',
                  text: this.currentOutputTranscription,
                });
              }

              if (newEntries.length > 0) {
                this.remodelTranscriptionHistory = [
                  ...this.remodelTranscriptionHistory,
                  ...newEntries,
                ];
              }

              this.currentInputTranscription = '';
              this.currentOutputTranscription = '';
              this.outputTranscriptionComplete = true;
            }

            if (message.toolCall) {
              const functionResponses = await Promise.all(
                message.toolCall.functionCalls.map(async (fc) => {
                  let result = 'Error: Unknown function call.';
                  if (fc.name === 'generate_room_design') {
                    result = await this.handleGenerateRoomDesign(
                      fc.args.description as string,
                    );
                  }
                  return {
                    id: fc.id,
                    name: fc.name,
                    response: {result},
                  };
                }),
              );

              try {
                const session = await this.sessionPromise;
                if (session) {
                  session.sendToolResponse({functionResponses});
                }
              } catch (e) {
                this.error = 'Error communicating with the assistant.';
              }
            }

            if (message.serverContent?.interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.error = e.message;
          },
          onclose: (e: CloseEvent) => {},
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
          },
          systemInstruction: instruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{functionDeclarations: tools}],
        },
      });
    } catch (e) {
      this.error = e.message;
      console.error(e);
      throw e;
    }
  }

  private async _startMicrophoneStream() {
    if (this.isRecording) return;
    this.inputAudioContext.resume();

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        4096,
        1,
        1,
      );
      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording || !this.sessionPromise) return;
        const pcmData = audioProcessingEvent.inputBuffer.getChannelData(0);
        this.sessionPromise.then((session) => {
          session.sendRealtimeInput({media: createBlob(pcmData)});
        });
      };
      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);
      this.isRecording = true;
    } catch (err) {
      this.error = `Error starting recording: ${err.message}`;
      console.error('Error starting recording:', err);
      this.stopRecording();
    } finally {
      this.isStartingConversation = false;
    }
  }

  private async startRecording() {
    if (this.isRecording || this.isStartingConversation) return;

    this.isStartingConversation = true;
    this.error = '';

    try {
      this.initSession();
      await this.sessionPromise;

      const greetingText = `Great, let's design your new room! What style are you thinking of? For example, you can say 'make it a modern living room' or 'I'd like to see it with a coastal vibe'.`;
      this.remodelTranscriptionHistory = [{role: 'model', text: greetingText}];

      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{parts: [{text: greetingText}]}],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
          },
        },
      });

      const audioData =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioData) {
        throw new Error('API did not return audio for the initial greeting.');
      }

      this.isSpeaking = true;

      const audioBuffer = await decodeAudioData(
        decode(audioData),
        this.outputAudioContext,
        24000,
        1,
      );

      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputNode);
      source.onended = () => {
        this._startMicrophoneStream();
      };
      source.start();

      this.speechTimeout = window.setTimeout(() => {
        this.isSpeaking = false;
      }, audioBuffer.duration * 1000 + 200);
    } catch (err) {
      this.error = `Error starting conversation: ${err.message}`;
      console.error(err);
      this.isStartingConversation = false;
      this.sessionPromise = null;
    }
  }

  private stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
      this.scriptProcessorNode = null;
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  private async endConversation() {
    this.stopRecording();
    if (this.sessionPromise) {
      try {
        const session = await this.sessionPromise;
        session.close();
      } catch (e) {
        console.error('Error closing session:', e);
        this.error = 'Error ending conversation.';
      }
    }
    this.sessionPromise = null;
    this.currentInputTranscription = '';
    this.currentOutputTranscription = '';
  }

  private toggleRecording() {
    if (this.isRecording || this.isStartingConversation) {
      this.endConversation();
    } else {
      this.startRecording();
    }
  }

  private handleImageUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        this.remodelImage = event.target?.result as string;
        this.toggleRecording();
      };
      reader.readAsDataURL(input.files[0]);
    }
  }

  private async startVideoStream() {
    try {
      if (!this.videoElement) {
        await (this as any).updateComplete;
      }
      const stream = await navigator.mediaDevices.getUserMedia({video: true});
      this.videoElement.srcObject = stream;
    } catch (err) {
      this.error = 'Could not access camera.';
      this.showCameraModal = false;
    }
  }

  private stopVideoStream() {
    if (this.videoElement && this.videoElement.srcObject) {
      const stream = this.videoElement.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      this.videoElement.srcObject = null;
    }
  }

  private handleCapturePhoto() {
    if (!this.videoElement) return;
    const context = this.canvasElement.getContext('2d');
    this.canvasElement.width = this.videoElement.videoWidth;
    this.canvasElement.height = this.videoElement.videoHeight;
    context?.drawImage(
      this.videoElement,
      0,
      0,
      this.videoElement.videoWidth,
      this.videoElement.videoHeight,
    );
    this.remodelImage = this.canvasElement.toDataURL('image/jpeg');
    this.toggleRecording();
    this.showCameraModal = false;
  }

  private async handleGenerateRoomDesign(prompt: string) {
    const baseImage =
      this.activeImageIndex !== null
        ? this.generatedImageHistory[this.activeImageIndex]
        : this.remodelImage;

    if (!baseImage) {
      this.error = 'Cannot generate design without a base image.';
      return 'Error: No base image was provided to generate a design from.';
    }

    this.isRemodeling = true;
    this.error = '';
    try {
      const base64Data = baseImage.split(',')[1];
      const mimeType = baseImage.match(/data:(.*);/)?.[1];
      if (!base64Data || !mimeType) {
        throw new Error('Invalid image format.');
      }

      const imagePart = {inlineData: {data: base64Data, mimeType}};
      const textPart = {
        text: `Apply the following style to the user's room image, preserving the original layout: ${prompt}`,
      };

      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {parts: [imagePart, textPart]},
        config: {
          responseModalities: [Modality.IMAGE],
        },
      });

      let newImageGenerated = false;
      if (response.candidates && response.candidates.length > 0) {
        const imagePart = response.candidates[0].content.parts.find(
          (p) => p.inlineData && p.inlineData.data,
        );
        if (imagePart && imagePart.inlineData) {
          const newImageSrc = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
          this.generatedImageHistory = [
            ...this.generatedImageHistory,
            newImageSrc,
          ];
          this.activeImageIndex = this.generatedImageHistory.length - 1;
          newImageGenerated = true;
        }
      }

      if (newImageGenerated) {
        return 'Success, the new room design has been generated and is now displayed.';
      } else {
        this.error = 'The model did not return a valid image.';
        return 'Error: The design could not be generated. The model did not return an image.';
      }
    } catch (err) {
      this.error = `Image generation failed: ${err.message}`;
      console.error('Image generation error:', err);
      return `Error: Image generation failed. ${err.message}`;
    } finally {
      this.isRemodeling = false;
    }
  }

  private handleThumbnailClick(index: number) {
    this.activeImageIndex = index;
  }

  private resetState() {
    this.endConversation();
    this.remodelImage = null;
    this.generatedImageHistory = [];
    this.activeImageIndex = null;
    this.isRemodeling = false;
    this.remodelTranscriptionHistory = [];
    this.showCameraModal = false;
    this.error = '';
  }

  renderControls() {
    const isMicActive = this.isRecording || this.isStartingConversation;
    return html`
      <div class="controls-container">
        <div class="controls">
          <button
            class="mic-button ${isMicActive ? 'end-call' : ''}"
            @click=${this.toggleRecording}
            ?disabled=${this.isStartingConversation || this.isRemodeling}
          >
            ${
              this.isStartingConversation || this.isRemodeling
                ? html`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 9.24 20.84 6.78 18.95 5.05" stroke="white" stroke-width="4" stroke-linecap="round"/></svg>`
                : isMicActive
                ? html`<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 2c1.1 0 2 .9 2 2v4.73l-6-6C8.48 2.24 9.19 2 10 2c.35 0 .68.06 1 .16L12 2zM3.72 2.3L2.31 3.72 6.07 7.47C6.02 7.63 6 7.81 6 8H4c0 .43.06.85.17 1.25L2.38 7.46C2.15 8.26 2 9.11 2 10h2c0-.59.08-1.16.22-1.7L7 11v1c0 2.21 1.79 4 4 4 .71 0 1.36-.19 1.93-.52l2.65 2.65c-1.13.78-2.45 1.27-3.91 1.32V22h-2v-2.02c-2.85-.43-5-2.91-5-5.98H5c0 .48.05.95.14 1.4L8.29 13.3c-.2-.43-.29-.9-.29-1.39V8l-3.29-3.29L3.72 2.3z m16.1 11.23c.1-.41.18-.83.18-1.25h-2c0 .28-.03.55-.08.81l1.72 1.72c.08-.44.16-.88.16-1.35h2c0 1.1-.21 2.14-.59 3.08l-1.61-1.61zM18 8h-2c0 1.3-.54 2.47-1.38 3.34l1.43 1.43C17.18 11.8 18 10.01 18 8z"/></svg>`
                : html`<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.42 2.58 2.66 4.54 5.21 4.81V21h-2c-.55 0-1 .45-1 1s.45 1 1 1h6c.55 0 1-.45 1-1s-.45-1-1-1h-2v-3.05c2.54-.27 4.79-2.23 5.21-4.81.09-.6-.39-1.14-1-1.14z"/></svg>`
            }
          </button>
          <gdm-live-audio-visuals
            class="visualizer"
            .inputNode=${this.inputNode}
            .outputNode=${this.outputNode}
            ?isListening=${this.isRecording}
            ?isSpeaking=${this.isSpeaking}
          >
          </gdm-live-audio-visuals>
          <div style="width: 40px; height: 40px;"></div>
        </div>
        <div class="transcription-preview">
          ${
            this.isRemodeling
              ? 'Generating your new room design...'
              : this.isRecording
              ? this.currentInputTranscription
              : this.isSpeaking
              ? this.currentOutputTranscription
              : this.error
              ? html`<span style="color: red;">${this.error}</span>`
              : ''
          }
        </div>
      </div>
    `;
  }

  renderChatHistory() {
    return html`${this.remodelTranscriptionHistory.map(
      (entry) => html`
        <div class="chat-bubble ${entry.role}">
          ${unsafeHTML(entry.text.replace(/\n/g, '<br>'))}
        </div>
      `,
    )}`;
  }

  // Renders the initial view for image upload
  renderImageUploadView() {
    return html`
      <div class="tab-container">
        <input
          type="file"
          id="image-upload-input"
          accept="image/*"
          @change=${this.handleImageUpload}
        />
        <div
          class="image-dropzone"
          @click=${() => this.imageUploadInput?.click()}
        >
          <p>${this.placeholderDescription}</p>
          <div class="image-actions">
            <button
              class="action-btn"
              @click=${(e: Event) => {
                e.stopPropagation();
                this.imageUploadInput?.click();
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload
            </button>
            <button class="action-btn" @click=${(e: Event) => {
              e.stopPropagation();
              this.showCameraModal = true;
            }}>
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Take Photo
            </button>
          </div>
        </div>
      </div>
    `;
  }

  renderCameraModal() {
    return html`
      <div class="modal-overlay" @click=${() => (this.showCameraModal = false)}>
         <div class="modal-content camera-modal-content" @click=${(e: Event) =>
           e.stopPropagation()}>
           <video id="camera-video" autoplay playsinline></video>
           <canvas id="camera-canvas" style="display:none;"></canvas>
           <div class="modal-footer">
             <button class="download-button" @click=${
               this.handleCapturePhoto
             }>Capture Photo</button>
           </div>
         </div>
      </div>
    `;
  }

  // --- MOBILE RENDERING ---
  renderMobile() {
    return html`
      <div class="widget widget-mobile">
        <div class="header">
          <div
            class="avatar"
            style="background-image: url('${this.avatar}')"
          ></div>
          <div class="agent-info">
            <div class="agent-name">${this.agentName}</div>
            <div class="agent-status">Online</div>
          </div>
        </div>
        ${
          this.remodelImage
            ? this.renderMobileConversationView()
            : this.renderImageUploadView()
        }
        ${this.showCameraModal ? this.renderCameraModal() : nothing}
      </div>
    `;
  }

  renderMobileConversationView() {
    return html`
      <div class="remodel-design-view">
        <div class="remodel-images-container">
          <div class="remodel-image-wrapper">
            <img src=${this.remodelImage} alt="Original room" />
            <div class="label">Original</div>
          </div>
          <div class="remodel-image-wrapper">
            ${this.renderGeneratedImage()}
            <div class="label">New Design</div>
          </div>
        </div>
        <div class="remodel-actions">
          <button class="action-btn secondary" @click=${this.resetState}>Start New</button>
        </div>
        ${
          this.generatedImageHistory.length > 0
            ? this.renderImageGallery()
            : nothing
        }
        <div class="chat-container">${this.renderChatHistory()}</div>
      </div>
      ${this.renderControls()}
    `;
  }

  // --- WIDESCREEN RENDERING ---
  renderWidescreen() {
    return html`
       <div class="widget widget-widescreen">
          ${
            this.remodelImage
              ? this.renderWidescreenConversationView()
              : html`<div class="widescreen-uploader-wrapper">${this.renderImageUploadView()}</div>`
          }
          ${this.showCameraModal ? this.renderCameraModal() : nothing}
      </div>
    `;
  }

  renderWidescreenConversationView() {
    return html`
      <div class="remodel-widescreen-sidebar">
        <div class="remodel-image-wrapper">
          <img src=${this.remodelImage} alt="Original room" />
          <div class="label">Original</div>
        </div>
        <div class="remodel-actions">
          <button class="action-btn secondary" @click=${this.resetState}>Start New Project</button>
        </div>
        ${this.renderControls()}
      </div>
      <div class="remodel-widescreen-main">
        <div class="new-design-container">
          <div class="latest-image-wrapper">
            ${this.renderGeneratedImage()}
            <div class="label">New Design</div>
          </div>
          ${
            this.generatedImageHistory.length > 0
              ? this.renderImageGallery()
              : nothing
          }
        </div>
      </div>
    `;
  }

  renderGeneratedImage() {
    const activeImage =
      this.activeImageIndex !== null
        ? this.generatedImageHistory[this.activeImageIndex]
        : null;

    return activeImage
      ? html`<img src=${activeImage} alt="New room design" />`
      : html`<div class="generated-image-placeholder">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.898 20.572L16.25 21.75l-.648-1.178a3.375 3.375 0 00-2.455-2.456L12 17.25l1.178-.648a3.375 3.375 0 002.455-2.456L16.25 13.5l.648 1.178a3.375 3.375 0 002.456 2.456L20.25 18l-1.178.648a3.375 3.375 0 00-2.456 2.456z"
            />
          </svg>
          <span>New Design</span>
        </div>`;
  }

  renderImageGallery() {
    return html`
      <div class="gallery-container">
        <div class="gallery-title">Design History</div>
        <div class="gallery-scroll">
          ${this.generatedImageHistory.map(
            (imgSrc, index) => html`
              <img
                src=${imgSrc}
                class="gallery-thumbnail ${index === this.activeImageIndex
                  ? 'active'
                  : ''}"
                alt="Design iteration ${index + 1}"
                @click=${() => this.handleThumbnailClick(index)}
              />
            `,
          )}
        </div>
      </div>
    `;
  }

  // --- MAIN RENDER ---
  render() {
    return this.isWidescreen ? this.renderWidescreen() : this.renderMobile();
  }
}

@customElement('gdm-landscaping-widget')
export class GdmLandscapingWidget extends LitElement {
  // Component State
  @state() isRecording = false;
  @state() isSpeaking = false;
  @state() error = '';
  @state() private isStartingConversation = false;
  @state() private remodelImage: string | null = null;
  @state() private generatedImageHistory: string[] = [];
  @state() private activeImageIndex: number | null = null;
  @state() private isRemodeling = false;
  @state() private remodelTranscriptionHistory: TranscriptionHistory[] = [];
  @state() private showCameraModal = false;
  @state() private isWidescreen = window.innerWidth >= 992;

  // Component Properties
  @property({type: String}) agentName = 'Virtual Assistant';
  @property({type: String, attribute: 'placeholder-title'})
  placeholderTitle = 'Virtual Assistant';
  @property({type: String, attribute: 'placeholder-description'})
  placeholderDescription =
    'Click the microphone below to start our conversation.';
  @property({type: String})
  avatar = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white' width='24px' height='24px'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E`;
  @property({type: String, attribute: 'placeholder-avatar'})
  placeholderAvatar = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white' width='48px' height='48px'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E`;

  @state() private currentInputTranscription = '';
  @state() private currentOutputTranscription = '';
  private outputTranscriptionComplete = false;
  private speechTimeout: number;
  private client: GoogleGenAI;
  private sessionPromise: Promise<Session> | null = null;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: MediaStreamAudioSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();
  private resizeObserver: ResizeObserver;

  @query('#camera-video') private videoElement: HTMLVideoElement;
  @query('#camera-canvas') private canvasElement: HTMLCanvasElement;
  @query('#image-upload-input') private imageUploadInput: HTMLInputElement;

  static styles = GdmRemodelWidget.styles;

  constructor() {
    super();
    this.initAudio();
    this.client = new GoogleGenAI({apiKey: process.env.API_KEY});
    this.outputNode.connect(this.outputAudioContext.destination);
  }

  connectedCallback() {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver(() => {
      const isWidescreenNow = window.innerWidth >= 992;
      if (isWidescreenNow !== this.isWidescreen) {
        this.isWidescreen = isWidescreenNow;
      }
    });
    this.resizeObserver.observe(this as unknown as Element);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver.disconnect();
  }

  protected updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has('showCameraModal')) {
      if (this.showCameraModal) {
        this.startVideoStream();
      } else {
        this.stopVideoStream();
      }
    }
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private initSession() {
    const instruction = `You are an expert landscape designer AI. The user has uploaded a photo of their current yard or outdoor space. Your goal is to have a conversation with them and translate their ideas into detailed descriptions for the 'generate_landscape_design' tool.

**Conversation and Prompting Guide:**
1.  **Initial Design:** After greeting the user, ask them what they'd like to change. Encourage them to be specific.
2.  **Crafting the Description:** When you have a clear idea of what they want, create a detailed, descriptive prompt for the tool. A good prompt includes:
    *   **Overall Style:** (e.g., modern xeriscape, lush English garden, Japanese zen garden).
    *   **Specific Elements to Add or Replace:** (e.g., "replace the messy brick borders around the trees with clean, stacked slate stone", "add a curving flagstone pathway from the patio to the back gate", "plant a vibrant flower bed with lavender and salvia along the fence").
    *   **Materials and Colors:** (e.g., dark mulch, gray river rocks, cedar wood for planters).
3.  **Tool Call:** Use the \`generate_landscape_design\` tool with the detailed description you've created.
4.  **Follow-up Edits:** After a design is generated, the user might ask for edits. Create a new, complete description for the tool that incorporates their changes.
5.  **Silent Confirmation:** After a tool call is successful, DO NOT provide a verbal confirmation. The user will see the image update on their screen. Wait silently for their next command.`;
    const tools: FunctionDeclaration[] = [
      {
        name: 'generate_landscape_design',
        description:
          'Generates a new landscape design image based on the user-provided photo and a text description of the desired changes.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            description: {
              type: Type.STRING,
              description:
                'A detailed prompt describing the desired landscape style, plants, hardscaping, and features. For example: "A modern, drought-tolerant xeriscape with native grasses, a gravel pathway, and large decorative boulders."',
            },
          },
          required: ['description'],
        },
      },
    ];

    try {
      this.sessionPromise = this.client.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {},
          onmessage: async (message: LiveServerMessage) => {
            clearTimeout(this.speechTimeout);
            this.speechTimeout = window.setTimeout(() => {
              this.isSpeaking = false;
            }, 1000);

            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;
            if (audio) {
              this.isSpeaking = true;
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );
              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });
              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              if (this.outputTranscriptionComplete) {
                this.currentOutputTranscription = text;
                this.outputTranscriptionComplete = false;
              } else {
                this.currentOutputTranscription += text;
              }
            } else if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              this.currentInputTranscription += text;
            }

            if (message.serverContent?.turnComplete) {
              const newEntries: TranscriptionHistory[] = [];
              if (this.currentInputTranscription.trim()) {
                newEntries.push({
                  role: 'user',
                  text: this.currentInputTranscription,
                });
              }
              if (this.currentOutputTranscription.trim()) {
                newEntries.push({
                  role: 'model',
                  text: this.currentOutputTranscription,
                });
              }

              if (newEntries.length > 0) {
                this.remodelTranscriptionHistory = [
                  ...this.remodelTranscriptionHistory,
                  ...newEntries,
                ];
              }

              this.currentInputTranscription = '';
              this.currentOutputTranscription = '';
              this.outputTranscriptionComplete = true;
            }

            if (message.toolCall) {
              const functionResponses = await Promise.all(
                message.toolCall.functionCalls.map(async (fc) => {
                  let result = 'Error: Unknown function call.';
                  if (fc.name === 'generate_landscape_design') {
                    result = await this.handleGenerateLandscapeDesign(
                      fc.args.description as string,
                    );
                  }
                  return {
                    id: fc.id,
                    name: fc.name,
                    response: {result},
                  };
                }),
              );

              try {
                const session = await this.sessionPromise;
                if (session) {
                  session.sendToolResponse({functionResponses});
                }
              } catch (e) {
                this.error = 'Error communicating with the assistant.';
              }
            }

            if (message.serverContent?.interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.error = e.message;
          },
          onclose: (e: CloseEvent) => {},
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
          },
          systemInstruction: instruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{functionDeclarations: tools}],
        },
      });
    } catch (e) {
      this.error = e.message;
      console.error(e);
      throw e;
    }
  }

  private async _startMicrophoneStream() {
    if (this.isRecording) return;
    this.inputAudioContext.resume();

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        4096,
        1,
        1,
      );
      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording || !this.sessionPromise) return;
        const pcmData = audioProcessingEvent.inputBuffer.getChannelData(0);
        this.sessionPromise.then((session) => {
          session.sendRealtimeInput({media: createBlob(pcmData)});
        });
      };
      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);
      this.isRecording = true;
    } catch (err) {
      this.error = `Error starting recording: ${err.message}`;
      console.error('Error starting recording:', err);
      this.stopRecording();
    } finally {
      this.isStartingConversation = false;
    }
  }

  private async startRecording() {
    if (this.isRecording || this.isStartingConversation) return;

    this.isStartingConversation = true;
    this.error = '';

    try {
      this.initSession();
      await this.sessionPromise;

      const greetingText = `Great, let's design your new landscape! What style are you thinking of? For example, you can say 'give me a modern xeriscape' or 'I'd like to see it with a cottage garden feel'.`;
      this.remodelTranscriptionHistory = [{role: 'model', text: greetingText}];

      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{parts: [{text: greetingText}]}],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
          },
        },
      });

      const audioData =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioData) {
        throw new Error('API did not return audio for the initial greeting.');
      }

      this.isSpeaking = true;

      const audioBuffer = await decodeAudioData(
        decode(audioData),
        this.outputAudioContext,
        24000,
        1,
      );

      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputNode);
      source.onended = () => {
        this._startMicrophoneStream();
      };
      source.start();

      this.speechTimeout = window.setTimeout(() => {
        this.isSpeaking = false;
      }, audioBuffer.duration * 1000 + 200);
    } catch (err) {
      this.error = `Error starting conversation: ${err.message}`;
      console.error(err);
      this.isStartingConversation = false;
      this.sessionPromise = null;
    }
  }

  private stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
      this.scriptProcessorNode = null;
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  private async endConversation() {
    this.stopRecording();
    if (this.sessionPromise) {
      try {
        const session = await this.sessionPromise;
        session.close();
      } catch (e) {
        console.error('Error closing session:', e);
        this.error = 'Error ending conversation.';
      }
    }
    this.sessionPromise = null;
    this.currentInputTranscription = '';
    this.currentOutputTranscription = '';
  }

  private toggleRecording() {
    if (this.isRecording || this.isStartingConversation) {
      this.endConversation();
    } else {
      this.startRecording();
    }
  }

  private handleImageUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        this.remodelImage = event.target?.result as string;
        this.toggleRecording();
      };
      reader.readAsDataURL(input.files[0]);
    }
  }

  private async startVideoStream() {
    try {
      if (!this.videoElement) {
        await (this as any).updateComplete;
      }
      const stream = await navigator.mediaDevices.getUserMedia({video: true});
      this.videoElement.srcObject = stream;
    } catch (err) {
      this.error = 'Could not access camera.';
      this.showCameraModal = false;
    }
  }

  private stopVideoStream() {
    if (this.videoElement && this.videoElement.srcObject) {
      const stream = this.videoElement.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      this.videoElement.srcObject = null;
    }
  }

  private handleCapturePhoto() {
    if (!this.videoElement) return;
    const context = this.canvasElement.getContext('2d');
    this.canvasElement.width = this.videoElement.videoWidth;
    this.canvasElement.height = this.videoElement.videoHeight;
    context?.drawImage(
      this.videoElement,
      0,
      0,
      this.videoElement.videoWidth,
      this.videoElement.videoHeight,
    );
    this.remodelImage = this.canvasElement.toDataURL('image/jpeg');
    this.toggleRecording();
    this.showCameraModal = false;
  }

  private async handleGenerateLandscapeDesign(prompt: string) {
    const baseImage =
      this.activeImageIndex !== null
        ? this.generatedImageHistory[this.activeImageIndex]
        : this.remodelImage;

    if (!baseImage) {
      this.error = 'Cannot generate design without a base image.';
      return 'Error: No base image was provided to generate a design from.';
    }

    this.isRemodeling = true;
    this.error = '';
    try {
      const base64Data = baseImage.split(',')[1];
      const mimeType = baseImage.match(/data:(.*);/)?.[1];
      if (!base64Data || !mimeType) {
        throw new Error('Invalid image format.');
      }

      const imagePart = {inlineData: {data: base64Data, mimeType}};
      const textPart = {
        text: `You are an expert landscape architect AI. Your task is to intelligently redesign the user's yard based on the provided image and their request.

**Key Instructions:**
1.  **Preserve Core Structures:** Do NOT change the house, large existing trees, or the fundamental layout of the property. Focus ONLY on the landscaping elements (lawn, garden beds, pathways, borders, etc.).
2.  **Redesign and Replace:** When the user asks for a new design, you must completely REPLACE old, messy, or undesirable elements with new, clean ones. For example, if the original image has messy brick borders, and the user asks for a modern look, you should generate new, clean-lined stone or wood borders in their place. DO NOT just paint over the old bricks.
3.  **Incorporate New Features:** Add new elements like plants, flower beds, stone patios, walkways, and other hardscaping features as described in the user's request.
4.  **Realism:** The final image should look realistic and seamlessly integrated.

**User's Request:**
${prompt}`,
      };

      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {parts: [imagePart, textPart]},
        config: {
          responseModalities: [Modality.IMAGE],
        },
      });

      let newImageGenerated = false;
      if (response.candidates && response.candidates.length > 0) {
        const imagePart = response.candidates[0].content.parts.find(
          (p) => p.inlineData && p.inlineData.data,
        );
        if (imagePart && imagePart.inlineData) {
          const newImageSrc = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
          this.generatedImageHistory = [
            ...this.generatedImageHistory,
            newImageSrc,
          ];
          this.activeImageIndex = this.generatedImageHistory.length - 1;
          newImageGenerated = true;
        }
      }

      if (newImageGenerated) {
        return 'Success, the new landscape design has been generated and is now displayed.';
      } else {
        this.error = 'The model did not return a valid image.';
        return 'Error: The design could not be generated. The model did not return an image.';
      }
    } catch (err) {
      this.error = `Image generation failed: ${err.message}`;
      console.error('Image generation error:', err);
      return `Error: Image generation failed. ${err.message}`;
    } finally {
      this.isRemodeling = false;
    }
  }

  private handleThumbnailClick(index: number) {
    this.activeImageIndex = index;
  }

  private resetState() {
    this.endConversation();
    this.remodelImage = null;
    this.generatedImageHistory = [];
    this.activeImageIndex = null;
    this.isRemodeling = false;
    this.remodelTranscriptionHistory = [];
    this.showCameraModal = false;
    this.error = '';
  }

  renderControls() {
    const isMicActive = this.isRecording || this.isStartingConversation;
    return html`
      <div class="controls-container">
        <div class="controls">
          <button
            class="mic-button ${isMicActive ? 'end-call' : ''}"
            @click=${this.toggleRecording}
            ?disabled=${this.isStartingConversation || this.isRemodeling}
          >
            ${
              this.isStartingConversation || this.isRemodeling
                ? html`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 9.24 20.84 6.78 18.95 5.05" stroke="white" stroke-width="4" stroke-linecap="round"/></svg>`
                : isMicActive
                ? html`<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 2c1.1 0 2 .9 2 2v4.73l-6-6C8.48 2.24 9.19 2 10 2c.35 0 .68.06 1 .16L12 2zM3.72 2.3L2.31 3.72 6.07 7.47C6.02 7.63 6 7.81 6 8H4c0 .43.06.85.17 1.25L2.38 7.46C2.15 8.26 2 9.11 2 10h2c0-.59.08-1.16.22-1.7L7 11v1c0 2.21 1.79 4 4 4 .71 0 1.36-.19 1.93-.52l2.65 2.65c-1.13.78-2.45 1.27-3.91 1.32V22h-2v-2.02c-2.85-.43-5-2.91-5-5.98H5c0 .48.05.95.14 1.4L8.29 13.3c-.2-.43-.29-.9-.29-1.39V8l-3.29-3.29L3.72 2.3z m16.1 11.23c.1-.41.18-.83.18-1.25h-2c0 .28-.03.55-.08.81l1.72 1.72c.08-.44.16-.88.16-1.35h2c0 1.1-.21 2.14-.59 3.08l-1.61-1.61zM18 8h-2c0 1.3-.54 2.47-1.38 3.34l1.43 1.43C17.18 11.8 18 10.01 18 8z"/></svg>`
                : html`<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.42 2.58 2.66 4.54 5.21 4.81V21h-2c-.55 0-1 .45-1 1s.45 1 1 1h6c.55 0 1-.45 1-1s-.45-1-1-1h-2v-3.05c2.54-.27 4.79-2.23 5.21-4.81.09-.6-.39-1.14-1-1.14z"/></svg>`
            }
          </button>
          <gdm-live-audio-visuals
            class="visualizer"
            .inputNode=${this.inputNode}
            .outputNode=${this.outputNode}
            ?isListening=${this.isRecording}
            ?isSpeaking=${this.isSpeaking}
          >
          </gdm-live-audio-visuals>
          <div style="width: 40px; height: 40px;"></div>
        </div>
        <div class="transcription-preview">
          ${
            this.isRemodeling
              ? 'Generating your new landscape design...'
              : this.isRecording
              ? this.currentInputTranscription
              : this.isSpeaking
              ? this.currentOutputTranscription
              : this.error
              ? html`<span style="color: red;">${this.error}</span>`
              : ''
          }
        </div>
      </div>
    `;
  }

  renderChatHistory() {
    return html`${this.remodelTranscriptionHistory.map(
      (entry) => html`
        <div class="chat-bubble ${entry.role}">
          ${unsafeHTML(entry.text.replace(/\n/g, '<br>'))}
        </div>
      `,
    )}`;
  }

  // Renders the initial view for image upload
  renderImageUploadView() {
    return html`
      <div class="tab-container">
        <input
          type="file"
          id="image-upload-input"
          accept="image/*"
          @change=${this.handleImageUpload}
        />
        <div
          class="image-dropzone"
          @click=${() => this.imageUploadInput?.click()}
        >
          <p>${this.placeholderDescription}</p>
          <div class="image-actions">
            <button
              class="action-btn"
              @click=${(e: Event) => {
                e.stopPropagation();
                this.imageUploadInput?.click();
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload
            </button>
            <button class="action-btn" @click=${(e: Event) => {
              e.stopPropagation();
              this.showCameraModal = true;
            }}>
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Take Photo
            </button>
          </div>
        </div>
      </div>
    `;
  }

  renderCameraModal() {
    return html`
      <div class="modal-overlay" @click=${() => (this.showCameraModal = false)}>
         <div class="modal-content camera-modal-content" @click=${(e: Event) =>
           e.stopPropagation()}>
           <video id="camera-video" autoplay playsinline></video>
           <canvas id="camera-canvas" style="display:none;"></canvas>
           <div class="modal-footer">
             <button class="download-button" @click=${
               this.handleCapturePhoto
             }>Capture Photo</button>
           </div>
         </div>
      </div>
    `;
  }

  // --- MOBILE RENDERING ---
  renderMobile() {
    return html`
      <div class="widget widget-mobile">
        <div class="header">
          <div
            class="avatar"
            style="background-image: url('${this.avatar}')"
          ></div>
          <div class="agent-info">
            <div class="agent-name">${this.agentName}</div>
            <div class="agent-status">Online</div>
          </div>
        </div>
        ${
          this.remodelImage
            ? this.renderMobileConversationView()
            : this.renderImageUploadView()
        }
        ${this.showCameraModal ? this.renderCameraModal() : nothing}
      </div>
    `;
  }

  renderMobileConversationView() {
    return html`
      <div class="remodel-design-view">
        <div class="remodel-images-container">
          <div class="remodel-image-wrapper">
            <img src=${this.remodelImage} alt="Original yard" />
            <div class="label">Original</div>
          </div>
          <div class="remodel-image-wrapper">
            ${this.renderGeneratedImage()}
            <div class="label">New Design</div>
          </div>
        </div>
        <div class="remodel-actions">
          <button class="action-btn secondary" @click=${this.resetState}>Start New</button>
        </div>
        ${
          this.generatedImageHistory.length > 0
            ? this.renderImageGallery()
            : nothing
        }
        <div class="chat-container">${this.renderChatHistory()}</div>
      </div>
      ${this.renderControls()}
    `;
  }

  // --- WIDESCREEN RENDERING ---
  renderWidescreen() {
    return html`
       <div class="widget widget-widescreen">
          ${
            this.remodelImage
              ? this.renderWidescreenConversationView()
              : html`<div class="widescreen-uploader-wrapper">${this.renderImageUploadView()}</div>`
          }
          ${this.showCameraModal ? this.renderCameraModal() : nothing}
      </div>
    `;
  }

  renderWidescreenConversationView() {
    return html`
      <div class="remodel-widescreen-sidebar">
        <div class="remodel-image-wrapper">
          <img src=${this.remodelImage} alt="Original yard" />
          <div class="label">Original</div>
        </div>
        <div class="remodel-actions">
          <button class="action-btn secondary" @click=${this.resetState}>Start New Project</button>
        </div>
        ${this.renderControls()}
      </div>
      <div class="remodel-widescreen-main">
        <div class="new-design-container">
          <div class="latest-image-wrapper">
            ${this.renderGeneratedImage()}
            <div class="label">New Design</div>
          </div>
          ${
            this.generatedImageHistory.length > 0
              ? this.renderImageGallery()
              : nothing
          }
        </div>
      </div>
    `;
  }

  renderGeneratedImage() {
    const activeImage =
      this.activeImageIndex !== null
        ? this.generatedImageHistory[this.activeImageIndex]
        : null;

    return activeImage
      ? html`<img src=${activeImage} alt="New landscape design" />`
      : html`<div class="generated-image-placeholder">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.898 20.572L16.25 21.75l-.648-1.178a3.375 3.375 0 00-2.455-2.456L12 17.25l1.178-.648a3.375 3.375 0 002.455-2.456L16.25 13.5l.648 1.178a3.375 3.375 0 002.456 2.456L20.25 18l-1.178.648a3.375 3.375 0 00-2.456 2.456z"
            />
          </svg>
          <span>New Design</span>
        </div>`;
  }

  renderImageGallery() {
    return html`
      <div class="gallery-container">
        <div class="gallery-title">Design History</div>
        <div class="gallery-scroll">
          ${this.generatedImageHistory.map(
            (imgSrc, index) => html`
              <img
                src=${imgSrc}
                class="gallery-thumbnail ${index === this.activeImageIndex
                  ? 'active'
                  : ''}"
                alt="Design iteration ${index + 1}"
                @click=${() => this.handleThumbnailClick(index)}
              />
            `,
          )}
        </div>
      </div>
    `;
  }

  // --- MAIN RENDER ---
  render() {
    return this.isWidescreen ? this.renderWidescreen() : this.renderMobile();
  }
}

@customElement('gdm-water-damage-widget')
export class GdmWaterDamageWidget extends LitElement {
  // Component State
  @state() isRecording = false;
  @state() isSpeaking = false;
  @state() error = '';
  @state() private isStartingConversation = false;
  @state() private remodelImage: string | null = null;
  @state() private generatedImageHistory: string[] = [];
  @state() private activeImageIndex: number | null = null;
  @state() private isRemodeling = false;
  @state() private remodelTranscriptionHistory: TranscriptionHistory[] = [];
  @state() private showCameraModal = false;
  @state() private isWidescreen = window.innerWidth >= 992;

  // Component Properties
  @property({type: String}) agentName = 'Virtual Assistant';
  @property({type: String, attribute: 'placeholder-title'})
  placeholderTitle = 'Virtual Assistant';
  @property({type: String, attribute: 'placeholder-description'})
  placeholderDescription =
    'Click the microphone below to start our conversation.';
  @property({type: String})
  avatar = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white' width='24px' height='24px'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E`;
  @property({type: String, attribute: 'placeholder-avatar'})
  placeholderAvatar = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white' width='48px' height='48px'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E`;

  @state() private currentInputTranscription = '';
  @state() private currentOutputTranscription = '';
  private outputTranscriptionComplete = false;
  private speechTimeout: number;
  private client: GoogleGenAI;
  private sessionPromise: Promise<Session> | null = null;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: MediaStreamAudioSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();
  private resizeObserver: ResizeObserver;

  @query('#camera-video') private videoElement: HTMLVideoElement;
  @query('#camera-canvas') private canvasElement: HTMLCanvasElement;
  @query('#image-upload-input') private imageUploadInput: HTMLInputElement;

  static styles = GdmRemodelWidget.styles;

  constructor() {
    super();
    this.initAudio();
    this.client = new GoogleGenAI({apiKey: process.env.API_KEY});
    this.outputNode.connect(this.outputAudioContext.destination);
  }

  connectedCallback() {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver(() => {
      const isWidescreenNow = window.innerWidth >= 992;
      if (isWidescreenNow !== this.isWidescreen) {
        this.isWidescreen = isWidescreenNow;
      }
    });
    this.resizeObserver.observe(this as unknown as Element);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver.disconnect();
  }

  protected updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has('showCameraModal')) {
      if (this.showCameraModal) {
        this.startVideoStream();
      } else {
        this.stopVideoStream();
      }
    }
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private initSession() {
    const instruction = `You are an expert water damage restoration AI. The user has uploaded a photo of a water-damaged area in their home. Your goal is to have a conversation with them and then generate an image showing the area fully restored.

**Conversation and Prompting Guide:**
1.  **Initial Interaction:** After greeting the user, express empathy about their situation and ask them to describe what happened.
2.  **Gather Details:** Ask clarifying questions to understand the extent of the damage (e.g., "How long has the area been wet?", "Is there a noticeable smell?").
3.  **Crafting the Description:** When you have enough information, or if the user simply asks to see it fixed, create a prompt for the tool. The prompt should be a simple instruction to restore the area. For example: "Restore the water damage in this room. Repair the ceiling, fix the walls, and replace the damaged flooring."
4.  **Tool Call:** Use the \`generate_restoration_image\` tool with the description you've created.
5.  **Follow-up Edits:** After a design is generated, the user might ask for further edits. Create a new, complete description for the tool that incorporates their changes.
6.  **Silent Confirmation:** After a tool call is successful, DO NOT provide a verbal confirmation. The user will see the image update on their screen. Wait silently for their next command.`;
    const tools: FunctionDeclaration[] = [
      {
        name: 'generate_restoration_image',
        description:
          'Generates an image showing the water-damaged area fully repaired and restored based on the user-provided photo and a description.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            description: {
              type: Type.STRING,
              description:
                'A detailed prompt describing the restoration work. For example: "Repair the water stains on the ceiling and wall, and replace the warped wooden floorboards to look like new."',
            },
          },
          required: ['description'],
        },
      },
    ];

    try {
      this.sessionPromise = this.client.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {},
          onmessage: async (message: LiveServerMessage) => {
            clearTimeout(this.speechTimeout);
            this.speechTimeout = window.setTimeout(() => {
              this.isSpeaking = false;
            }, 1000);

            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;
            if (audio) {
              this.isSpeaking = true;
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );
              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });
              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              if (this.outputTranscriptionComplete) {
                this.currentOutputTranscription = text;
                this.outputTranscriptionComplete = false;
              } else {
                this.currentOutputTranscription += text;
              }
            } else if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              this.currentInputTranscription += text;
            }

            if (message.serverContent?.turnComplete) {
              const newEntries: TranscriptionHistory[] = [];
              if (this.currentInputTranscription.trim()) {
                newEntries.push({
                  role: 'user',
                  text: this.currentInputTranscription,
                });
              }
              if (this.currentOutputTranscription.trim()) {
                newEntries.push({
                  role: 'model',
                  text: this.currentOutputTranscription,
                });
              }

              if (newEntries.length > 0) {
                this.remodelTranscriptionHistory = [
                  ...this.remodelTranscriptionHistory,
                  ...newEntries,
                ];
              }

              this.currentInputTranscription = '';
              this.currentOutputTranscription = '';
              this.outputTranscriptionComplete = true;
            }

            if (message.toolCall) {
              const functionResponses = await Promise.all(
                message.toolCall.functionCalls.map(async (fc) => {
                  let result = 'Error: Unknown function call.';
                  if (fc.name === 'generate_restoration_image') {
                    result = await this.handleGenerateRestorationImage(
                      fc.args.description as string,
                    );
                  }
                  return {
                    id: fc.id,
                    name: fc.name,
                    response: {result},
                  };
                }),
              );

              try {
                const session = await this.sessionPromise;
                if (session) {
                  session.sendToolResponse({functionResponses});
                }
              } catch (e) {
                this.error = 'Error communicating with the assistant.';
              }
            }

            if (message.serverContent?.interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.error = e.message;
          },
          onclose: (e: CloseEvent) => {},
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
          },
          systemInstruction: instruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{functionDeclarations: tools}],
        },
      });
    } catch (e) {
      this.error = e.message;
      console.error(e);
      throw e;
    }
  }

  private async _startMicrophoneStream() {
    if (this.isRecording) return;
    this.inputAudioContext.resume();

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        4096,
        1,
        1,
      );
      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording || !this.sessionPromise) return;
        const pcmData = audioProcessingEvent.inputBuffer.getChannelData(0);
        this.sessionPromise.then((session) => {
          session.sendRealtimeInput({media: createBlob(pcmData)});
        });
      };
      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);
      this.isRecording = true;
    } catch (err) {
      this.error = `Error starting recording: ${err.message}`;
      console.error('Error starting recording:', err);
      this.stopRecording();
    } finally {
      this.isStartingConversation = false;
    }
  }

  private async startRecording() {
    if (this.isRecording || this.isStartingConversation) return;

    this.isStartingConversation = true;
    this.error = '';

    try {
      this.initSession();
      await this.sessionPromise;

      const greetingText = `I see you've uploaded a photo of some water damage. I'm here to help. Could you tell me a little about what happened?`;
      this.remodelTranscriptionHistory = [{role: 'model', text: greetingText}];

      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{parts: [{text: greetingText}]}],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
          },
        },
      });

      const audioData =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioData) {
        throw new Error('API did not return audio for the initial greeting.');
      }

      this.isSpeaking = true;

      const audioBuffer = await decodeAudioData(
        decode(audioData),
        this.outputAudioContext,
        24000,
        1,
      );

      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputNode);
      source.onended = () => {
        this._startMicrophoneStream();
      };
      source.start();

      this.speechTimeout = window.setTimeout(() => {
        this.isSpeaking = false;
      }, audioBuffer.duration * 1000 + 200);
    } catch (err) {
      this.error = `Error starting conversation: ${err.message}`;
      console.error(err);
      this.isStartingConversation = false;
      this.sessionPromise = null;
    }
  }

  private stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
      this.scriptProcessorNode = null;
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  private async endConversation() {
    this.stopRecording();
    if (this.sessionPromise) {
      try {
        const session = await this.sessionPromise;
        session.close();
      } catch (e) {
        console.error('Error closing session:', e);
        this.error = 'Error ending conversation.';
      }
    }
    this.sessionPromise = null;
    this.currentInputTranscription = '';
    this.currentOutputTranscription = '';
  }

  private toggleRecording() {
    if (this.isRecording || this.isStartingConversation) {
      this.endConversation();
    } else {
      this.startRecording();
    }
  }

  private handleImageUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        this.remodelImage = event.target?.result as string;
        this.toggleRecording();
      };
      reader.readAsDataURL(input.files[0]);
    }
  }

  private async startVideoStream() {
    try {
      if (!this.videoElement) {
        await (this as any).updateComplete;
      }
      const stream = await navigator.mediaDevices.getUserMedia({video: true});
      this.videoElement.srcObject = stream;
    } catch (err) {
      this.error = 'Could not access camera.';
      this.showCameraModal = false;
    }
  }

  private stopVideoStream() {
    if (this.videoElement && this.videoElement.srcObject) {
      const stream = this.videoElement.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      this.videoElement.srcObject = null;
    }
  }

  private handleCapturePhoto() {
    if (!this.videoElement) return;
    const context = this.canvasElement.getContext('2d');
    this.canvasElement.width = this.videoElement.videoWidth;
    this.canvasElement.height = this.videoElement.videoHeight;
    context?.drawImage(
      this.videoElement,
      0,
      0,
      this.videoElement.videoWidth,
      this.videoElement.videoHeight,
    );
    this.remodelImage = this.canvasElement.toDataURL('image/jpeg');
    this.toggleRecording();
    this.showCameraModal = false;
  }

  private async handleGenerateRestorationImage(prompt: string) {
    const baseImage =
      this.activeImageIndex !== null
        ? this.generatedImageHistory[this.activeImageIndex]
        : this.remodelImage;

    if (!baseImage) {
      this.error = 'Cannot generate design without a base image.';
      return 'Error: No base image was provided to generate a design from.';
    }

    this.isRemodeling = true;
    this.error = '';
    try {
      const base64Data = baseImage.split(',')[1];
      const mimeType = baseImage.match(/data:(.*);/)?.[1];
      if (!base64Data || !mimeType) {
        throw new Error('Invalid image format.');
      }

      const imagePart = {inlineData: {data: base64Data, mimeType}};
      const textPart = {
        text: `You are an expert photo editor specializing in water damage restoration. Your task is to realistically repair the damage shown in the user's photo.

**Key Instructions:**
1.  **Identify and Repair:** Analyze the image to find all signs of water damage. This includes stains on walls and ceilings, peeling paint, warped flooring (wood, laminate, etc.), damaged baseboards, and any visible mold.
2.  **Seamless Restoration:** Your goal is to make the room look as if the damage never happened. You must completely REMOVE the damaged areas and REPLACE them with perfectly restored surfaces.
3.  **Match Existing Surfaces:** The repairs should blend in perfectly. Match the original paint color, texture, flooring material, and wood finish. The restored area should not look like a patch.
4.  **Preserve the Room:** Do NOT change the room's layout, furniture, or any undamaged elements. The focus is strictly on repairing the water damage.

**User's Request:**
${prompt}`,
      };

      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {parts: [imagePart, textPart]},
        config: {
          responseModalities: [Modality.IMAGE],
        },
      });

      let newImageGenerated = false;
      if (response.candidates && response.candidates.length > 0) {
        const imagePart = response.candidates[0].content.parts.find(
          (p) => p.inlineData && p.inlineData.data,
        );
        if (imagePart && imagePart.inlineData) {
          const newImageSrc = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
          this.generatedImageHistory = [
            ...this.generatedImageHistory,
            newImageSrc,
          ];
          this.activeImageIndex = this.generatedImageHistory.length - 1;
          newImageGenerated = true;
        }
      }

      if (newImageGenerated) {
        return 'Success, the new restored image has been generated and is now displayed.';
      } else {
        this.error = 'The model did not return a valid image.';
        return 'Error: The restoration could not be generated. The model did not return an image.';
      }
    } catch (err) {
      this.error = `Image generation failed: ${err.message}`;
      console.error('Image generation error:', err);
      return `Error: Image generation failed. ${err.message}`;
    } finally {
      this.isRemodeling = false;
    }
  }

  private handleThumbnailClick(index: number) {
    this.activeImageIndex = index;
  }

  private resetState() {
    this.endConversation();
    this.remodelImage = null;
    this.generatedImageHistory = [];
    this.activeImageIndex = null;
    this.isRemodeling = false;
    this.remodelTranscriptionHistory = [];
    this.showCameraModal = false;
    this.error = '';
  }

  renderControls() {
    const isMicActive = this.isRecording || this.isStartingConversation;
    return html`
      <div class="controls-container">
        <div class="controls">
          <button
            class="mic-button ${isMicActive ? 'end-call' : ''}"
            @click=${this.toggleRecording}
            ?disabled=${this.isStartingConversation || this.isRemodeling}
          >
            ${
              this.isStartingConversation || this.isRemodeling
                ? html`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 9.24 20.84 6.78 18.95 5.05" stroke="white" stroke-width="4" stroke-linecap="round"/></svg>`
                : isMicActive
                ? html`<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 2c1.1 0 2 .9 2 2v4.73l-6-6C8.48 2.24 9.19 2 10 2c.35 0 .68.06 1 .16L12 2zM3.72 2.3L2.31 3.72 6.07 7.47C6.02 7.63 6 7.81 6 8H4c0 .43.06.85.17 1.25L2.38 7.46C2.15 8.26 2 9.11 2 10h2c0-.59.08-1.16.22-1.7L7 11v1c0 2.21 1.79 4 4 4 .71 0 1.36-.19 1.93-.52l2.65 2.65c-1.13.78-2.45 1.27-3.91 1.32V22h-2v-2.02c-2.85-.43-5-2.91-5-5.98H5c0 .48.05.95.14 1.4L8.29 13.3c-.2-.43-.29-.9-.29-1.39V8l-3.29-3.29L3.72 2.3z m16.1 11.23c.1-.41.18-.83.18-1.25h-2c0 .28-.03.55-.08.81l1.72 1.72c.08-.44.16-.88.16-1.35h2c0 1.1-.21 2.14-.59 3.08l-1.61-1.61zM18 8h-2c0 1.3-.54 2.47-1.38 3.34l1.43 1.43C17.18 11.8 18 10.01 18 8z"/></svg>`
                : html`<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.42 2.58 2.66 4.54 5.21 4.81V21h-2c-.55 0-1 .45-1 1s.45 1 1 1h6c.55 0 1-.45 1-1s-.45-1-1-1h-2v-3.05c2.54-.27 4.79-2.23 5.21-4.81.09-.6-.39-1.14-1-1.14z"/></svg>`
            }
          </button>
          <gdm-live-audio-visuals
            class="visualizer"
            .inputNode=${this.inputNode}
            .outputNode=${this.outputNode}
            ?isListening=${this.isRecording}
            ?isSpeaking=${this.isSpeaking}
          >
          </gdm-live-audio-visuals>
          <div style="width: 40px; height: 40px;"></div>
        </div>
        <div class="transcription-preview">
          ${
            this.isRemodeling
              ? 'Generating restored view...'
              : this.isRecording
              ? this.currentInputTranscription
              : this.isSpeaking
              ? this.currentOutputTranscription
              : this.error
              ? html`<span style="color: red;">${this.error}</span>`
              : ''
          }
        </div>
      </div>
    `;
  }

  renderChatHistory() {
    return html`${this.remodelTranscriptionHistory.map(
      (entry) => html`
        <div class="chat-bubble ${entry.role}">
          ${unsafeHTML(entry.text.replace(/\n/g, '<br>'))}
        </div>
      `,
    )}`;
  }

  // Renders the initial view for image upload
  renderImageUploadView() {
    return html`
      <div class="tab-container">
        <input
          type="file"
          id="image-upload-input"
          accept="image/*"
          @change=${this.handleImageUpload}
        />
        <div
          class="image-dropzone"
          @click=${() => this.imageUploadInput?.click()}
        >
          <p>${this.placeholderDescription}</p>
          <div class="image-actions">
            <button
              class="action-btn"
              @click=${(e: Event) => {
                e.stopPropagation();
                this.imageUploadInput?.click();
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload
            </button>
            <button class="action-btn" @click=${(e: Event) => {
              e.stopPropagation();
              this.showCameraModal = true;
            }}>
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Take Photo
            </button>
          </div>
        </div>
      </div>
    `;
  }

  renderCameraModal() {
    return html`
      <div class="modal-overlay" @click=${() => (this.showCameraModal = false)}>
         <div class="modal-content camera-modal-content" @click=${(e: Event) =>
           e.stopPropagation()}>
           <video id="camera-video" autoplay playsinline></video>
           <canvas id="camera-canvas" style="display:none;"></canvas>
           <div class="modal-footer">
             <button class="download-button" @click=${
               this.handleCapturePhoto
             }>Capture Photo</button>
           </div>
         </div>
      </div>
    `;
  }

  // --- MOBILE RENDERING ---
  renderMobile() {
    return html`
      <div class="widget widget-mobile">
        <div class="header">
          <div
            class="avatar"
            style="background-image: url('${this.avatar}')"
          ></div>
          <div class="agent-info">
            <div class="agent-name">${this.agentName}</div>
            <div class="agent-status">Online</div>
          </div>
        </div>
        ${
          this.remodelImage
            ? this.renderMobileConversationView()
            : this.renderImageUploadView()
        }
        ${this.showCameraModal ? this.renderCameraModal() : nothing}
      </div>
    `;
  }

  renderMobileConversationView() {
    return html`
      <div class="remodel-design-view">
        <div class="remodel-images-container">
          <div class="remodel-image-wrapper">
            <img src=${this.remodelImage} alt="Original damage" />
            <div class="label">Original</div>
          </div>
          <div class="remodel-image-wrapper">
            ${this.renderGeneratedImage()}
            <div class="label">Restored View</div>
          </div>
        </div>
        <div class="remodel-actions">
          <button class="action-btn secondary" @click=${this.resetState}>Start New</button>
        </div>
        ${
          this.generatedImageHistory.length > 0
            ? this.renderImageGallery()
            : nothing
        }
        <div class="chat-container">${this.renderChatHistory()}</div>
      </div>
      ${this.renderControls()}
    `;
  }

  // --- WIDESCREEN RENDERING ---
  renderWidescreen() {
    return html`
       <div class="widget widget-widescreen">
          ${
            this.remodelImage
              ? this.renderWidescreenConversationView()
              : html`<div class="widescreen-uploader-wrapper">${this.renderImageUploadView()}</div>`
          }
          ${this.showCameraModal ? this.renderCameraModal() : nothing}
      </div>
    `;
  }

  renderWidescreenConversationView() {
    return html`
      <div class="remodel-widescreen-sidebar">
        <div class="remodel-image-wrapper">
          <img src=${this.remodelImage} alt="Original damage" />
          <div class="label">Original</div>
        </div>
        <div class="remodel-actions">
          <button class="action-btn secondary" @click=${this.resetState}>Start New Project</button>
        </div>
        ${this.renderControls()}
      </div>
      <div class="remodel-widescreen-main">
        <div class="new-design-container">
          <div class="latest-image-wrapper">
            ${this.renderGeneratedImage()}
            <div class="label">Restored View</div>
          </div>
          ${
            this.generatedImageHistory.length > 0
              ? this.renderImageGallery()
              : nothing
          }
        </div>
      </div>
    `;
  }

  renderGeneratedImage() {
    const activeImage =
      this.activeImageIndex !== null
        ? this.generatedImageHistory[this.activeImageIndex]
        : null;

    return activeImage
      ? html`<img src=${activeImage} alt="Restored view" />`
      : html`<div class="generated-image-placeholder">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.898 20.572L16.25 21.75l-.648-1.178a3.375 3.375 0 00-2.455-2.456L12 17.25l1.178-.648a3.375 3.375 0 002.455-2.456L16.25 13.5l.648 1.178a3.375 3.375 0 002.456 2.456L20.25 18l-1.178.648a3.375 3.375 0 00-2.456 2.456z"
            />
          </svg>
          <span>Restored View</span>
        </div>`;
  }

  renderImageGallery() {
    return html`
      <div class="gallery-container">
        <div class="gallery-title">Restoration History</div>
        <div class="gallery-scroll">
          ${this.generatedImageHistory.map(
            (imgSrc, index) => html`
              <img
                src=${imgSrc}
                class="gallery-thumbnail ${index === this.activeImageIndex
                  ? 'active'
                  : ''}"
                alt="Restoration iteration ${index + 1}"
                @click=${() => this.handleThumbnailClick(index)}
              />
            `,
          )}
        </div>
      </div>
    `;
  }

  // --- MAIN RENDER ---
  render() {
    return this.isWidescreen ? this.renderWidescreen() : this.renderMobile();
  }
}

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  // Component State
  @state() isRecording = false;
  @state() isSpeaking = false;
  @state() error = '';
  @state() private isStartingConversation = false;
  @state() private isGeneratingReport = false;
  @state() private generatedReport = '';
  @state() private showReportModal = false;
  @state() private isWidescreen = window.innerWidth >= 992;

  // Tab State
  @state() private activeTab: 'chat' | 'troubleshoot' = 'chat';

  // Troubleshoot State
  @state() private troubleshootImage: string | null = null;
  @state() private troubleshootPrompt = '';
  @state() private troubleshootResponse = '';
  @state() private isTroubleshooting = false;
  @state() private showCameraModal = false;
  @state() private isTroubleshootConversationActive = false;
  @state() private troubleshootTranscriptionHistory: TranscriptionHistory[] = [];

  // Component Properties
  @property({type: Boolean, attribute: 'enable-troubleshoot'})
  enableTroubleshoot = false;
  @property({type: String}) agentName = 'Virtual Assistant';
  @property({type: String, attribute: 'system-instruction'})
  systemInstruction = `Your job is to make every customer interaction smooth and effortless.

Always check if you have both name and email before logging a lead.
 If you’re missing either, politely ask the visitor for what’s missing.

If the customer asks about scheduling or availability:
 Ask for their preferred date and time.
 If they’re unsure, offer some available options (like “morning or afternoon this week?”).

Whenever you’re ready to schedule an appointment:
 Always confirm the full details with the customer before calling schedule_appointment.
 Example: “Just to confirm, you want to schedule for [day and time], and your email is [email]?”

After successfully logging a lead or scheduling, always let the customer know what will happen next:
 For leads: “We’ll contact you soon by email.”
 For appointments: “You will receive a calendar invite and an email confirmation.”

If a conversation pauses or becomes unclear, gently nudge for next steps:
 “Is there anything else I can help you with?”
 or
 “Would you like to schedule a call or ask another question?”

Never ask for personal info except name, email, and (if offered) phone.

Keep your responses concise, clear, and friendly.`;
  @property({type: String, attribute: 'report-instruction'})
  reportInstruction =
    'You are a helpful assistant. Summarize the following conversation clearly and concisely.';
  @property({type: String, attribute: 'placeholder-title'})
  placeholderTitle = 'Virtual Assistant';
  @property({type: String, attribute: 'placeholder-description'})
  placeholderDescription =
    'Click the microphone below to start our conversation.';
  @property({type: String})
  avatar = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white' width='24px' height='24px'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E`;
  @property({type: String, attribute: 'placeholder-avatar'})
  placeholderAvatar = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white' width='48px' height='48px'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E`;

  // Private state for chat
  @state() private transcriptionHistory: TranscriptionHistory[] = [];
  @state() private currentInputTranscription = '';
  @state() private currentOutputTranscription = '';
  private outputTranscriptionComplete = false;
  private speechTimeout: number;
  private resizeObserver: ResizeObserver;

  // Private state for Web Audio API and Live Session
  private client: GoogleGenAI;
  private sessionPromise: Promise<Session> | null = null;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: MediaStreamAudioSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  // Element Queries
  @query('#camera-video') private videoElement: HTMLVideoElement;
  @query('#camera-canvas') private canvasElement: HTMLCanvasElement;
  @query('#image-upload-input') private imageUploadInput: HTMLInputElement;

  static styles = css`
    :host {
      --brand-primary: #007aff;
      --brand-secondary: #34c759;
      --background-color: #ffffff;
      --text-primary: #1d1d1f;
      --text-secondary: #6e6e73;
      --user-bubble-background: #e9e9eb;
      --model-bubble-background: var(--brand-primary);
      --model-bubble-text: #ffffff;
      --border-radius: 24px;
      --font-family: 'Inter', sans-serif;
      --font-headline: 'Poppins', sans-serif;
      --border-color: #eaecef;
    }

    .widget {
      background: var(--background-color);
      border-radius: var(--border-radius);
      display: flex;
      flex-direction: column;
      font-family: var(--font-family);
      position: relative; /* Anchor for the modal */
      overflow: hidden;
    }

    /* --- RESPONSIVE STYLES --- */
    @media (max-width: 991px) {
      .widget {
        width: 400px;
        max-width: 100%;
        height: 700px;
      }
    }
    @media (min-width: 992px) {
      .widget {
        width: 100%;
        height: 600px;
      }
      .widget.troubleshoot-widescreen {
        width: 100%;
        flex-direction: row;
      }
      .troubleshoot-main-panel {
        flex: 1.2;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
      }
      .troubleshoot-sidebar {
        flex: 1;
        display: flex;
        flex-direction: column;
        border-left: 1px solid var(--border-color);
        background-color: #f9f9fb;
      }
      .troubleshoot-sidebar .header {
        background-color: var(--background-color);
        border-bottom: 1px solid var(--border-color);
      }
      .troubleshoot-sidebar .chat-container {
        flex-grow: 1;
      }
      .troubleshoot-sidebar .controls-container {
        background: transparent;
        border-top: 1px solid var(--border-color);
      }
    }

    .header {
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid var(--user-bubble-background);
      flex-shrink: 0;
    }

    .header.tab-header {
      flex-direction: column;
      align-items: stretch;
      padding: 12px 20px;
    }

    .agent-info-static {
      font-weight: 700;
      font-size: 16px;
      color: var(--text-primary);
      text-align: center;
      margin-bottom: 12px;
    }

    .tabs {
      display: flex;
      background-color: #f0f2f5;
      border-radius: 10px;
      padding: 4px;
    }

    .tab-link {
      flex: 1;
      padding: 8px 12px;
      border: none;
      background: transparent;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-secondary);
      cursor: pointer;
      transition: background-color 0.2s, color 0.2s;
    }

    .tab-link.active {
      background-color: var(--background-color);
      color: var(--brand-primary);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background-color: var(--brand-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      background-size: 24px 24px;
      background-position: center;
      background-repeat: no-repeat;
    }

    .agent-info {
      display: flex;
      flex-direction: column;
    }

    .agent-name {
      font-weight: 700;
      font-size: 16px;
      color: var(--text-primary);
    }

    .agent-status {
      font-size: 13px;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .agent-status::before {
      content: '';
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--brand-secondary);
    }

    .visualizer {
      flex-grow: 1;
      height: 56px;
    }

    .chat-container {
      flex: 1;
      padding: 20px 20px 0 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }

    .placeholder {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      color: var(--text-secondary);
      padding: 0 30px 60px 30px;
      animation: fadeIn 0.5s ease-in-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .placeholder-avatar {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background-color: var(--brand-primary);
      margin-bottom: 20px;
      background-size: 48px 48px;
      background-position: center;
      background-repeat: no-repeat;
      box-shadow: 0 4px 12px rgba(0, 122, 255, 0.2);
    }

    .placeholder h3 {
      font-size: 22px;
      font-weight: 700;
      color: var(--text-primary);
      margin: 0 0 4px 0;
    }

    .placeholder p {
      font-size: 15px;
      margin: 0;
      line-height: 1.5;
    }

    .chat-bubble {
      max-width: 80%;
      padding: 10px 15px;
      border-radius: 18px;
      margin-bottom: 10px;
      font-size: 15px;
      line-height: 1.4;
    }

    .chat-bubble.user {
      background-color: var(--user-bubble-background);
      color: var(--text-primary);
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }

    .chat-bubble.model {
      background-color: var(--model-bubble-background);
      color: var(--model-bubble-text);
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }

    .quick-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
      align-self: flex-start;
    }

    .quick-action-btn {
      background: rgba(255, 255, 255, 0.2);
      border: none;
      color: white;
      padding: 8px 12px;
      border-radius: 16px;
      font-size: 13px;
      cursor: default;
    }

    .controls-container {
      padding: 10px 20px 20px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }

    .controls {
      display: flex;
      align-items: center;
      width: 100%;
      gap: 12px;
      padding: 6px;
      border: 3px solid var(--user-bubble-background);
      border-radius: 34px;
    }

    .mic-button {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.2s ease, box-shadow 0.2s ease;
      background-color: var(--brand-primary);
      box-shadow: 0 2px 8px rgba(0, 122, 255, 0.3);
      flex-shrink: 0;
    }

    .mic-button:disabled {
      background-color: #a0c3e6;
      cursor: not-allowed;
      box-shadow: none;
    }

    .mic-button.end-call {
      background-color: #f86262;
      box-shadow: 0 2px 8px rgba(255, 0, 0, 0.3);
    }

    .report-button {
      background-color: #f0f0f5;
      border: none;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.2s;
    }

    .report-button:hover {
      background-color: #e0e0e5;
    }

    .report-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .transcription-preview {
      font-size: 14px;
      color: var(--text-secondary);
      height: 20px;
      font-style: italic;
      text-align: center;
    }

    /* Modal Styles */
    .modal-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      animation: fadeIn 0.3s;
    }

    .modal-content {
      background: white;
      padding: 24px;
      border-radius: 16px;
      width: 90%;
      max-width: 500px;
      max-height: 80%;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #e9e9eb;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }

    .modal-header h3 {
      margin: 0;
      font-size: 18px;
    }

    .close-button {
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #6e6e73;
    }

    .report-body {
      overflow-y: auto;
      font-family: var(--font-family);
      background: #f7f7f8;
      padding: 16px 20px;
      border-radius: 8px;
      color: #333;
      flex-grow: 1;
      text-align: left;
    }

    .report-body h3 {
      font-family: var(--font-headline);
      font-size: 16px;
      color: var(--brand-primary);
      border-bottom: 2px solid var(--border-color);
      padding-bottom: 8px;
      margin-top: 20px;
      margin-bottom: 12px;
    }

    .report-body h3:first-child {
      margin-top: 0;
    }

    .report-body ul,
    .report-body ol {
      list-style-position: inside;
      padding-left: 5px;
      margin-bottom: 1em;
    }

    .report-body li {
      padding: 4px 0;
      font-size: 14px;
    }

    .report-body strong {
      color: var(--text-primary);
      font-weight: 600;
    }

    .report-body p {
      margin: 1em 0;
      font-size: 14px;
      line-height: 1.6;
    }

    .modal-footer {
      padding-top: 16px;
      margin-top: 16px;
      border-top: 1px solid #e9e9eb;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }

    .download-button {
      background-color: var(--brand-primary);
      color: white;
      border: none;
      padding: 10px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
    }

    /* Troubleshoot Shared Styles */
    .tab-container {
      flex: 1;
      padding: 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .conversation-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .conversation-wrapper .report-body {
      flex-shrink: 0; /* Prevent report from shrinking */
      margin: 0 20px;
      max-height: 40%; /* Limit height so chat is visible */
    }

    .conversation-wrapper .chat-container {
      padding-top: 10px;
      padding-bottom: 0;
    }

    .image-dropzone {
      border: 2px dashed #d9d9e3;
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      color: var(--text-secondary);
      cursor: pointer;
      position: relative;
      background: #f7f7f8;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 200px;
    }

    .image-preview {
      max-width: 100%;
      max-height: 200px;
      border-radius: 8px;
      margin-bottom: 12px;
    }

    .image-actions {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-top: 12px;
    }

    .action-btn {
      background: #e9e9eb;
      color: var(--text-primary);
      border: none;
      padding: 10px 16px;
      border-radius: 8px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .action-btn.secondary {
      background-color: transparent;
      border: 1px solid var(--border-color);
    }

    #image-upload-input {
      display: none;
    }

    .prompt-textarea {
      width: 100%;
      height: 80px;
      border-radius: 8px;
      border: 1px solid #d9d9e3;
      padding: 12px;
      font-family: inherit;
      font-size: 15px;
      resize: vertical;
    }

    .submit-btn {
      background-color: var(--brand-primary);
      color: white;
      width: 100%;
      padding: 14px;
      border: none;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
    }
    .submit-btn:disabled {
      background-color: #a0c3e6;
      cursor: not-allowed;
    }

    .troubleshoot-report-view {
      display: flex;
      flex-direction: column;
      gap: 16px;
      flex-grow: 1;
      padding: 20px;
      overflow-y: auto;
    }

    .troubleshoot-report-header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-color);
    }

    .report-thumbnail {
      width: 80px;
      height: 80px;
      object-fit: cover;
      border-radius: 8px;
      flex-shrink: 0;
    }

    .troubleshoot-report-header h3 {
      margin: 0;
      font-size: 18px;
      font-family: var(--font-headline);
    }

    /* Camera Modal Styles */
    .camera-modal-content {
      padding: 10px;
      max-width: 95%;
    }

    .camera-modal-content video {
      width: 100%;
      border-radius: 8px;
    }
  `;

  constructor() {
    super();
    this.initAudio();
    this.client = new GoogleGenAI({apiKey: process.env.API_KEY});
    this.outputNode.connect(this.outputAudioContext.destination);
  }

  connectedCallback() {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver(() => {
      const isWidescreenNow = window.innerWidth >= 992;
      if (isWidescreenNow !== this.isWidescreen) {
        this.isWidescreen = isWidescreenNow;
      }
    });
    this.resizeObserver.observe(this as unknown as Element);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver.disconnect();
  }

  protected updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has('showCameraModal')) {
      if (this.showCameraModal) {
        this.startVideoStream();
      } else {
        this.stopVideoStream();
      }
    }
  }

  // Fix: Added missing startVideoStream and stopVideoStream methods.
  private async startVideoStream() {
    try {
      if (!this.videoElement) {
        await (this as any).updateComplete;
      }
      const stream = await navigator.mediaDevices.getUserMedia({video: true});
      this.videoElement.srcObject = stream;
    } catch (err) {
      this.error = 'Could not access camera.';
      this.showCameraModal = false;
    }
  }

  private stopVideoStream() {
    if (this.videoElement && this.videoElement.srcObject) {
      const stream = this.videoElement.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      this.videoElement.srcObject = null;
    }
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private initSession(customSystemInstruction?: string) {
    const tools: FunctionDeclaration[] = [];
    const instruction = customSystemInstruction ?? this.systemInstruction;

    if (this.activeTab === 'chat') {
      tools.push(
        {
          name: 'capture_lead',
          description: 'Captures lead information from the user.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              name: {
                type: Type.STRING,
                description: 'The full name of the user.',
              },
              email: {
                type: Type.STRING,
                description: 'The email address of the user.',
              },
              phone: {
                type: Type.STRING,
                description: 'The phone number of the user. (Optional)',
              },
            },
            required: ['name', 'email'],
          },
        },
        {
          name: 'schedule_appointment',
          description: 'Schedules an appointment for the user.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              name: {
                type: Type.STRING,
                description: 'The full name of the user.',
              },
              email: {
                type: Type.STRING,
                description: 'The email address of the user.',
              },
              date: {
                type: Type.STRING,
                description:
                  'The preferred date for the appointment (e.g., "this Friday", "2024-08-15").',
              },
              time: {
                type: Type.STRING,
                description:
                  'The preferred time for the appointment (e.g., "2pm", "14:00").',
              },
            },
            required: ['name', 'email', 'date', 'time'],
          },
        },
      );
    }

    try {
      this.sessionPromise = this.client.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            if (this.activeTab === 'chat') {
              this.transcriptionHistory = [];
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            clearTimeout(this.speechTimeout);
            this.speechTimeout = window.setTimeout(() => {
              this.isSpeaking = false;
            }, 1000);

            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;
            if (audio) {
              this.isSpeaking = true;
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );
              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });
              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              if (this.outputTranscriptionComplete) {
                this.currentOutputTranscription = text;
                this.outputTranscriptionComplete = false;
              } else {
                this.currentOutputTranscription += text;
              }
            } else if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              this.currentInputTranscription += text;
            }

            if (message.serverContent?.turnComplete) {
              let history;
              let setHistory;

              if (this.activeTab === 'chat') {
                history = this.transcriptionHistory;
                setHistory = (newHistory: TranscriptionHistory[]) => {
                  this.transcriptionHistory = newHistory;
                };
              } else {
                history = this.troubleshootTranscriptionHistory;
                setHistory = (newHistory: TranscriptionHistory[]) => {
                  this.troubleshootTranscriptionHistory = newHistory;
                };
              }

              const newEntries: TranscriptionHistory[] = [];
              if (this.currentInputTranscription.trim()) {
                newEntries.push({
                  role: 'user',
                  text: this.currentInputTranscription,
                });
              }
              if (this.currentOutputTranscription.trim()) {
                newEntries.push({
                  role: 'model',
                  text: this.currentOutputTranscription,
                });
              }

              if (newEntries.length > 0) {
                setHistory([...history, ...newEntries]);
              }

              this.currentInputTranscription = '';
              this.currentOutputTranscription = '';
              this.outputTranscriptionComplete = true;
            }

            if (message.toolCall) {
              const functionCallPromises = message.toolCall.functionCalls.map(
                async (fc) => {
                  console.log(`Function call received: ${fc.name}`, fc.args);
                  const result = 'OK';
                  return {
                    id: fc.id,
                    name: fc.name,
                    response: {result},
                  };
                },
              );

              Promise.all(functionCallPromises).then((functionResponses) => {
                this.sessionPromise!.then((session) => {
                  session.sendToolResponse({functionResponses});
                });
              });
            }

            if (message.serverContent?.interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.error = e.message;
          },
          onclose: (e: CloseEvent) => {},
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
          },
          systemInstruction: instruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{functionDeclarations: tools}],
        },
      });
    } catch (e) {
      this.error = e.message;
      console.error(e);
      throw e; // Rethrow to be caught by start methods
    }
  }

  private async _startMicrophoneStream() {
    if (this.isRecording) return;
    this.inputAudioContext.resume();

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        4096,
        1,
        1,
      );
      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording || !this.sessionPromise) return;
        const pcmData = audioProcessingEvent.inputBuffer.getChannelData(0);
        this.sessionPromise.then((session) => {
          session.sendRealtimeInput({media: createBlob(pcmData)});
        });
      };
      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);
      this.isRecording = true;
    } catch (err) {
      this.error = `Error starting recording: ${err.message}`;
      console.error('Error starting recording:', err);
      this.stopRecording();
    } finally {
      this.isStartingConversation = false;
    }
  }

  private async startRecording() {
    if (this.isRecording || this.isStartingConversation) return;

    this.isStartingConversation = true;
    this.error = '';

    try {
      this.initSession();
      await this.sessionPromise;

      const greetingText = `Hello! I'm ${this.agentName}. Who do I have the pleasure of speaking with today?`;
      this.transcriptionHistory = [{role: 'model', text: greetingText}];

      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{parts: [{text: greetingText}]}],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
          },
        },
      });

      const audioData =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioData) {
        throw new Error('API did not return audio for the initial greeting.');
      }

      this.isSpeaking = true;

      const audioBuffer = await decodeAudioData(
        decode(audioData),
        this.outputAudioContext,
        24000,
        1,
      );

      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputNode);
      source.onended = () => {
        this._startMicrophoneStream();
      };
      source.start();

      this.speechTimeout = window.setTimeout(() => {
        this.isSpeaking = false;
      }, audioBuffer.duration * 1000 + 200);
    } catch (err) {
      this.error = `Error starting conversation: ${err.message}`;
      console.error(err);
      this.isStartingConversation = false;
      this.sessionPromise = null;
    }
  }

  private async startTroubleshootConversation() {
    if (this.isRecording || this.isStartingConversation) return;

    this.isStartingConversation = true;
    this.error = '';

    const instruction = `You are a helpful home services assistant. The user has uploaded an image, and you have already provided the following initial analysis:

    --- ANALYSIS START ---
    ${this.troubleshootResponse}
    --- ANALYSIS END ---

    Now, the user wants to talk to you about this analysis. Your job is to answer their follow-up questions, provide clarification, and offer further assistance based on this context. Start the conversation by asking something like, "Okay, I'm ready to discuss the analysis. What questions do you have for me?".`;

    try {
      this.initSession(instruction);
      await this.sessionPromise;

      const greetingText = `Okay, I'm ready to discuss the analysis. What questions do you have for me?`;

      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{parts: [{text: greetingText}]}],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
          },
        },
      });

      const audioData =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioData) {
        throw new Error('API did not return audio for the greeting.');
      }

      this.isTroubleshootConversationActive = true;
      this.troubleshootTranscriptionHistory = [
        {role: 'model', text: greetingText},
      ];
      this.isSpeaking = true;

      const audioBuffer = await decodeAudioData(
        decode(audioData),
        this.outputAudioContext,
        24000,
        1,
      );

      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputNode);
      source.onended = () => {
        this._startMicrophoneStream();
      };
      source.start();

      this.speechTimeout = window.setTimeout(() => {
        this.isSpeaking = false;
      }, audioBuffer.duration * 1000 + 200);
    } catch (err) {
      this.error = `Error starting troubleshoot conversation: ${err.message}`;
      console.error(err);
      this.isStartingConversation = false;
      this.sessionPromise = null;
    }
  }

  private stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
      this.scriptProcessorNode = null;
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  private async endConversation() {
    this.stopRecording();

    if (this.sessionPromise) {
      try {
        const session = await this.sessionPromise;
        session.close();
      } catch (e) {
        console.error('Error closing session:', e);
        this.error = 'Error ending conversation.';
      }
    }

    this.sessionPromise = null;
    this.currentInputTranscription = '';
    this.currentOutputTranscription = '';
    this.isTroubleshootConversationActive = false;
  }

  private toggleRecording() {
    if (this.isRecording || this.isStartingConversation) {
      this.endConversation();
    } else {
      if (this.activeTab === 'troubleshoot') {
        this.startTroubleshootConversation();
      } else {
        this.startRecording();
      }
    }
  }

  private formatTranscriptForReport() {
    return this.transcriptionHistory
      .map(
        (entry) =>
          `${entry.role === 'user' ? 'Client' : 'Assistant'}: ${entry.text}`,
      )
      .join('\n');
  }

  private async generateReport() {
    if (this.isGeneratingReport || this.transcriptionHistory.length === 0)
      return;

    this.isGeneratingReport = true;
    this.error = '';

    try {
      const transcript = this.formatTranscriptForReport();
      const prompt = `${this.reportInstruction}\n\n--- CONVERSATION TRANSCRIPT ---\n${transcript}`;

      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      // Fix: Correctly access the 'text' property from the GenerateContentResponse.
      this.generatedReport = response.text;
      this.showReportModal = true;
    } catch (err) {
      this.error = `Failed to generate report: ${err.message}`;
      console.error(err);
    } finally {
      this.isGeneratingReport = false;
    }
  }

  private getPdfStyles() {
    return `
      <style>
        body { font-family: Helvetica, sans-serif; font-size: 11pt; color: #333; line-height: 1.7; }
        .report-container { padding: 20px; }
        h2 { text-align: center; font-size: 20pt; font-weight: bold; color: #1a1a1a; margin-bottom: 30px; border-bottom: 2px solid #007aff; padding-bottom: 12px; }
        h3 { font-size: 15pt; font-weight: bold; color: #007aff; margin-top: 30px; margin-bottom: 15px; border-bottom: 1px solid #eaecef; padding-bottom: 6px; }
        ul, ol { padding-left: 20px; margin-bottom: 18px; }
        li { margin-bottom: 10px; }
        strong { font-weight: bold; color: #000; }
        p { margin-bottom: 18px; }
      </style>
    `;
  }

  // Fix: Added missing parseReportMarkdown method to handle markdown-to-HTML conversion.
  private parseReportMarkdown(markdown: string): string {
    if (!markdown) return '';

    const lines = markdown.trim().split('\n');
    let html = '';
    let inUl = false;
    let inOl = false;

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // Bold within line
      const processLine = (l: string) =>
        l.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

      // Headers
      if (trimmedLine.startsWith('### ')) {
        if (inUl) {
          html += '</ul>\n';
          inUl = false;
        }
        if (inOl) {
          html += '</ol>\n';
          inOl = false;
        }
        html += `<h3>${processLine(trimmedLine.substring(4))}</h3>\n`;
      } else if (trimmedLine.startsWith('## ')) {
        if (inUl) {
          html += '</ul>\n';
          inUl = false;
        }
        if (inOl) {
          html += '</ol>\n';
          inOl = false;
        }
        html += `<h2>${processLine(trimmedLine.substring(3))}</h2>\n`;
      } else if (trimmedLine.startsWith('# ')) {
        if (inUl) {
          html += '</ul>\n';
          inUl = false;
        }
        if (inOl) {
          html += '</ol>\n';
          inOl = false;
        }
        html += `<h1>${processLine(trimmedLine.substring(2))}</h1>\n`;
      }
      // Unordered List
      else if (trimmedLine.startsWith('* ') || trimmedLine.startsWith('- ')) {
        if (inOl) {
          html += '</ol>\n';
          inOl = false;
        }
        if (!inUl) {
          html += '<ul>\n';
          inUl = true;
        }
        html += `<li>${processLine(trimmedLine.substring(2))}</li>\n`;
      }
      // Ordered List
      else if (/^\d+\.\s/.test(trimmedLine)) {
        if (inUl) {
          html += '</ul>\n';
          inUl = false;
        }
        if (!inOl) {
          html += '<ol>\n';
          inOl = true;
        }
        html += `<li>${processLine(
          trimmedLine.replace(/^\d+\.\s/, ''),
        )}</li>\n`;
      }
      // Paragraph
      else {
        if (inUl) {
          html += '</ul>\n';
          inUl = false;
        }
        if (inOl) {
          html += '</ol>\n';
          inOl = false;
        }
        html += `<p>${processLine(trimmedLine)}</p>\n`;
      }
    }

    if (inUl) html += '</ul>\n';
    if (inOl) html += '</ol>\n';

    return html;
  }

  private async downloadPdf() {
    if (!this.generatedReport) return;
    this.error = '';
    try {
      const doc = new jsPDF();
      const reportHtml = `
        <html>
          <head>${this.getPdfStyles()}</head>
          <body>
            <div class="report-container">
              <h2>Conversation Report</h2>
              ${this.parseReportMarkdown(this.generatedReport)}
            </div>
          </body>
        </html>
      `;

      await doc.html(reportHtml, {
        callback: (doc) => {
          doc.save(`${this.agentName.replace(/\s/g, '_')}_Report.pdf`);
        },
        margin: [15, 15, 15, 15],
        autoPaging: 'text',
        width: 180,
      });
    } catch (err) {
      this.error = `Could not generate PDF: ${err.message}`;
    }
  }

  private handleImageUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        this.troubleshootImage = event.target?.result as string;
      };
      reader.readAsDataURL(input.files[0]);
    }
  }

  private handleTroubleshootPromptChange(e: Event) {
    const input = e.target as HTMLTextAreaElement;
    this.troubleshootPrompt = input.value;
  }

  private async handleTroubleshootSubmit() {
    if (!this.troubleshootImage || this.isTroubleshooting) return;

    this.isTroubleshooting = true;
    this.error = '';
    this.troubleshootResponse = '';

    try {
      const base64Data = this.troubleshootImage.split(',')[1];
      const mimeType = this.troubleshootImage.match(/data:(.*);/)?.[1];
      if (!base64Data || !mimeType) {
        throw new Error('Invalid image format.');
      }

      const imagePart = {inlineData: {data: base64Data, mimeType}};
      const textPart = {
        text: `Analyze the attached image and provide a step-by-step troubleshooting guide for the user's issue. The user described the issue as: "${this.troubleshootPrompt}". Structure your response with clear headings and numbered steps. Focus on safety and suggest when to call a professional.`,
      };

      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {parts: [imagePart, textPart]},
      });

      this.troubleshootResponse = response.text;
    } catch (err) {
      this.error = `Troubleshooting failed: ${err.message}`;
      console.error('Troubleshooting error:', err);
    } finally {
      this.isTroubleshooting = false;
    }
  }

  private handleCapturePhoto() {
    if (!this.videoElement) return;
    const context = this.canvasElement.getContext('2d');
    this.canvasElement.width = this.videoElement.videoWidth;
    this.canvasElement.height = this.videoElement.videoHeight;
    context?.drawImage(
      this.videoElement,
      0,
      0,
      this.videoElement.videoWidth,
      this.videoElement.videoHeight,
    );
    this.troubleshootImage = this.canvasElement.toDataURL('image/jpeg');
    this.showCameraModal = false;
  }

  private resetTroubleshootState() {
    this.endConversation();
    this.troubleshootImage = null;
    this.troubleshootPrompt = '';
    this.troubleshootResponse = '';
    this.isTroubleshooting = false;
    this.isTroubleshootConversationActive = false;
    this.troubleshootTranscriptionHistory = [];
    this.error = '';
  }

  private renderHeader() {
    if (this.enableTroubleshoot) {
      return html`
        <div class="header tab-header">
          <div class="agent-info-static">${this.agentName}</div>
          <div class="tabs">
            <button
              class="tab-link ${this.activeTab === 'chat' ? 'active' : ''}"
              @click=${() => (this.activeTab = 'chat')}
            >
              Chat
            </button>
            <button
              class="tab-link ${this.activeTab === 'troubleshoot'
                ? 'active'
                : ''}"
              @click=${() => (this.activeTab = 'troubleshoot')}
            >
              Troubleshoot
            </button>
          </div>
        </div>
      `;
    }
    return html`
      <div class="header">
        <div
          class="avatar"
          style="background-image: url('${this.avatar}')"
        ></div>
        <div class="agent-info">
          <div class="agent-name">${this.agentName}</div>
          <div class="agent-status">Online</div>
        </div>
      </div>
    `;
  }

  private renderPlaceholder() {
    return html`
      <div class="placeholder">
        <div
          class="placeholder-avatar"
          style="background-image: url('${this.placeholderAvatar}')"
        ></div>
        <h3>${this.placeholderTitle}</h3>
        <p>${this.placeholderDescription}</p>
      </div>
    `;
  }

  private renderChatHistory(history: TranscriptionHistory[]) {
    return html`${history.map(
      (entry) => html`
        <div class="chat-bubble ${entry.role}">
          ${unsafeHTML(entry.text.replace(/\n/g, '<br>'))}
        </div>
      `,
    )}`;
  }

  private renderControls() {
    const isMicActive = this.isRecording || this.isStartingConversation;
    const canGenerateReport =
      this.transcriptionHistory.length > 0 && this.activeTab === 'chat';
    const isMicDisabled =
      this.isStartingConversation ||
      (this.activeTab === 'troubleshoot' &&
        !this.isTroubleshootConversationActive);

    return html`
      <div class="controls-container">
        <div class="controls">
          ${
            this.activeTab === 'chat'
              ? html` <button
                  class="report-button"
                  @click=${this.generateReport}
                  ?disabled=${this.isGeneratingReport || !canGenerateReport}
                  title="Generate Conversation Summary"
                >
                  ${
                    this.isGeneratingReport
                      ? html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="animation: spin 1s linear infinite;"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 9.24 20.84 6.78 18.95 5.05" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`
                      : html`<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`
                  }
                </button>`
              : html`<div style="width: 40px; height: 40px;"></div>`
          }
          <button
            class="mic-button ${isMicActive ? 'end-call' : ''}"
            @click=${this.toggleRecording}
            ?disabled=${isMicDisabled}
          >
            ${
              this.isStartingConversation
                ? html`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="animation: spin 1s linear infinite;"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 9.24 20.84 6.78 18.95 5.05" stroke="white" stroke-width="4" stroke-linecap="round"/></svg>`
                : isMicActive
                ? html`<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 2c1.1 0 2 .9 2 2v4.73l-6-6C8.48 2.24 9.19 2 10 2c.35 0 .68.06 1 .16L12 2zM3.72 2.3L2.31 3.72 6.07 7.47C6.02 7.63 6 7.81 6 8H4c0 .43.06.85.17 1.25L2.38 7.46C2.15 8.26 2 9.11 2 10h2c0-.59.08-1.16.22-1.7L7 11v1c0 2.21 1.79 4 4 4 .71 0 1.36-.19 1.93-.52l2.65 2.65c-1.13.78-2.45 1.27-3.91 1.32V22h-2v-2.02c-2.85-.43-5-2.91-5-5.98H5c0 .48.05.95.14 1.4L8.29 13.3c-.2-.43-.29-.9-.29-1.39V8l-3.29-3.29L3.72 2.3z m16.1 11.23c.1-.41.18-.83.18-1.25h-2c0 .28-.03.55-.08.81l1.72 1.72c.08-.44.16-.88.16-1.35h2c0 1.1-.21 2.14-.59 3.08l-1.61-1.61zM18 8h-2c0 1.3-.54 2.47-1.38 3.34l1.43 1.43C17.18 11.8 18 10.01 18 8z"/></svg>`
                : html`<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.42 2.58 2.66 4.54 5.21 4.81V21h-2c-.55 0-1 .45-1 1s.45 1 1 1h6c.55 0 1-.45 1-1s-.45-1-1-1h-2v-3.05c2.54-.27 4.79-2.23 5.21-4.81.09-.6-.39-1.14-1-1.14z"/></svg>`
            }
          </button>
          <gdm-live-audio-visuals
            class="visualizer"
            .inputNode=${this.inputNode}
            .outputNode=${this.outputNode}
            ?isListening=${this.isRecording}
            ?isSpeaking=${this.isSpeaking}
          >
          </gdm-live-audio-visuals>
          <div style="width: 40px; height: 40px;"></div>
        </div>
        <div class="transcription-preview">
          ${
            this.isRecording
              ? this.currentInputTranscription
              : this.isSpeaking
              ? this.currentOutputTranscription
              : this.error
              ? html`<span style="color: red;">${this.error}</span>`
              : ''
          }
        </div>
      </div>
    `;
  }

  private renderReportModal() {
    return html`
      <div class="modal-overlay" @click=${() => (this.showReportModal = false)}>
        <div class="modal-content" @click=${(e: Event) => e.stopPropagation()}>
          <div class="modal-header">
            <h3>Conversation Summary</h3>
            <button
              class="close-button"
              @click=${() => (this.showReportModal = false)}
            >
              &times;
            </button>
          </div>
          <div class="report-body">
            ${unsafeHTML(this.parseReportMarkdown(this.generatedReport))}
          </div>
          <div class="modal-footer">
            <button class="download-button" @click=${this.downloadPdf}>
              Download PDF
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderCameraModal() {
    return html`
      <div class="modal-overlay" @click=${() => (this.showCameraModal = false)}>
        <div
          class="modal-content camera-modal-content"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <video id="camera-video" autoplay playsinline></video>
          <canvas id="camera-canvas" style="display:none;"></canvas>
          <div class="modal-footer">
            <button class="download-button" @click=${this.handleCapturePhoto}>
              Capture Photo
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderChatTab() {
    return html`
      ${this.transcriptionHistory.length === 0 &&
      !this.isRecording &&
      !this.isSpeaking
        ? this.renderPlaceholder()
        : html`<div class="chat-container">
            ${this.renderChatHistory(this.transcriptionHistory)}
          </div>`}
      ${this.renderControls()}
    `;
  }

  private renderTroubleshootUploadView() {
    return html`
      <div class="tab-container">
        <input
          type="file"
          id="image-upload-input"
          accept="image/*"
          @change=${this.handleImageUpload}
        />
        <div
          class="image-dropzone"
          @click=${() => this.imageUploadInput?.click()}
        >
          ${
            this.troubleshootImage
              ? html`<img
                  src=${this.troubleshootImage}
                  class="image-preview"
                  alt="Troubleshoot preview"
                />`
              : ''
          }
          <p>
            ${
              this.troubleshootImage
                ? 'Image selected. Change?'
                : 'Upload or take a photo of the issue.'
            }
          </p>
          <div class="image-actions">
            <button
              class="action-btn"
              @click=${(e: Event) => {
                e.stopPropagation();
                this.imageUploadInput?.click();
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload
            </button>
            <button class="action-btn" @click=${(e: Event) => {
              e.stopPropagation();
              this.showCameraModal = true;
            }}>
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Take Photo
            </button>
          </div>
        </div>
        <textarea
          class="prompt-textarea"
          .value=${this.troubleshootPrompt}
          @input=${this.handleTroubleshootPromptChange}
          placeholder="Briefly describe the issue (e.g., 'My AC unit is making a loud noise.')."
        ></textarea>
        <button
          class="submit-btn"
          ?disabled=${!this.troubleshootImage ||
          !this.troubleshootPrompt ||
          this.isTroubleshooting}
          @click=${this.handleTroubleshootSubmit}
        >
          ${this.isTroubleshooting ? 'Analyzing...' : 'Get Help'}
        </button>
      </div>
    `;
  }

  private renderTroubleshootReportView() {
    return html`
      <div class="troubleshoot-report-view">
        <div class="troubleshoot-report-header">
          <img
            src=${this.troubleshootImage}
            class="report-thumbnail"
            alt="User provided image"
          />
          <h3>Troubleshooting Analysis</h3>
        </div>
        <div class="report-body">
          ${unsafeHTML(this.parseReportMarkdown(this.troubleshootResponse))}
        </div>
        ${
          !this.isWidescreen
            ? html`
                <button
                  class="action-btn secondary"
                  @click=${this.resetTroubleshootState}
                >
                  Start New
                </button>
                <div class="conversation-wrapper">
                  <div class="chat-container">
                    ${this.renderChatHistory(
                      this.troubleshootTranscriptionHistory,
                    )}
                  </div>
                  ${this.renderControls()}
                </div>
              `
            : nothing
        }
      </div>
    `;
  }

  private renderTroubleshootTab() {
    if (this.troubleshootResponse) {
      return this.renderTroubleshootReportView();
    } else {
      return this.renderTroubleshootUploadView();
    }
  }

  private renderMobileLayout() {
    return html`
      <div class="widget">
        ${this.renderHeader()}
        ${this.activeTab === 'chat'
          ? this.renderChatTab()
          : this.renderTroubleshootTab()}
        ${this.showReportModal ? this.renderReportModal() : nothing}
        ${this.showCameraModal ? this.renderCameraModal() : nothing}
      </div>
    `;
  }

  private renderWidescreenLayout() {
    return html`
      <div class="widget troubleshoot-widescreen">
        <div class="troubleshoot-main-panel">
          ${this.renderTroubleshootReportView()}
        </div>
        <div class="troubleshoot-sidebar">
          <div class="header">
            <div class="agent-info">
              <div class="agent-name">${this.agentName}</div>
              <div class="agent-status">Ready to Help</div>
            </div>
          </div>
          <div class="chat-container">
            ${this.renderChatHistory(this.troubleshootTranscriptionHistory)}
          </div>
          ${this.renderControls()}
        </div>
        ${this.showReportModal ? this.renderReportModal() : nothing}
      </div>
    `;
  }

  render() {
    const isTroubleshootMode =
      this.enableTroubleshoot && this.troubleshootResponse;
    if (this.isWidescreen && isTroubleshootMode) {
      return this.renderWidescreenLayout();
    } else {
      return this.renderMobileLayout();
    }
  }
}
