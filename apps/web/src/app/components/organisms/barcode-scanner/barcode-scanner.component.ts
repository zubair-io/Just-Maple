import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  signal,
  output,
  inject,
  OnDestroy,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { BrowserCodeReader, BrowserMultiFormatReader, BarcodeFormat } from '@zxing/browser';
import { DecodeHintType } from '@zxing/library';
import { CollectibleRegistryService } from '../../../services/collectible-registry.service';
import type { CollectibleRegistry } from '@maple/shared';

interface VideoInputDevice {
  deviceId: string;
  label: string;
  groupId: string;
  kind: string;
}

interface CameraCapabilities {
  focusMode?: {
    includes: (mode: string) => boolean;
  };
  zoom?: boolean;
  torch?: boolean;
}

@Component({
  selector: 'app-barcode-scanner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './barcode-scanner.component.html',
  styleUrl: './barcode-scanner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarcodeScannerComponent implements AfterViewInit, OnDestroy {
  private readonly registryService = inject(CollectibleRegistryService);

  @ViewChild('barcodeInput') barcodeInput!: ElementRef<HTMLInputElement>;
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;

  readonly cameraScanning = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly scanned = output<CollectibleRegistry>();
  readonly notFound = output<string>();
  readonly close = output<void>();

  private controls: { stop: () => void } | null = null;

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.barcodeInput?.nativeElement?.focus();
    }, 100);
  }

  ngOnDestroy(): void {
    this.stop();
  }

  closeScanner(): void {
    this.stop();
    this.close.emit();
  }

  stop(): void {
    this.cameraScanning.set(false);
    this.controls?.stop();
    this.controls = null;
  }

  blur(): void {
    setTimeout(() => {
      this.barcodeInput?.nativeElement?.focus();
    }, 100);
  }

  handleInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const text = input.value.trim();
    input.value = '';

    if (!text) return;

    this.stop();
    this.loading.set(true);
    this.error.set(null);
    this.loadUpcData(text);
  }

  loadUpcData(barcode: string): void {
    this.registryService.getByBarcode(barcode).subscribe({
      next: (registry) => {
        this.loading.set(false);
        if (registry) {
          this.scanned.emit(registry);
        } else {
          this.error.set(`No item found for barcode: ${barcode}`);
          this.notFound.emit(barcode);
        }
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Failed to lookup barcode');
      },
    });
  }

  async startScan(): Promise<void> {
    this.cameraScanning.set(true);
    this.error.set(null);

    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.UPC_A]);

      const codeReader = new BrowserMultiFormatReader(hints);
      const videoInputDevices = await BrowserCodeReader.listVideoInputDevices();

      if (videoInputDevices.length === 0) {
        this.error.set('No camera found');
        this.cameraScanning.set(false);
        return;
      }

      const selectedDevice = await this.getBestBarcodeCamera(videoInputDevices);

      this.controls = await codeReader.decodeFromVideoDevice(
        selectedDevice.deviceId,
        this.videoElement.nativeElement,
        (result, _error, controls) => {
          if (result) {
            controls.stop();
            this.loading.set(true);
            this.cameraScanning.set(false);
            this.loadUpcData(result.getText());
          }
        },
      );
    } catch (err) {
      console.error('Camera error:', err);
      this.error.set('Failed to access camera');
      this.cameraScanning.set(false);
    }
  }

  private async getBestBarcodeCamera(
    videoInputDevices: VideoInputDevice[],
  ): Promise<VideoInputDevice> {
    let bestDevice: VideoInputDevice | null = null;
    let highestScore = -1;

    for (const device of videoInputDevices) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: device.deviceId,
            // @ts-expect-error - advanced constraints not in types
            advanced: [{ focusMode: ['continuous'], zoom: true, torch: true }],
          },
        });

        const track = stream.getVideoTracks()[0];
        const capabilities = track.getCapabilities() as CameraCapabilities;
        stream.getTracks().forEach((t) => t.stop());

        let score = 0;
        if (capabilities.focusMode?.includes('continuous')) score += 2;
        if (capabilities.zoom) score += 1;
        if (capabilities.torch) score += 1;
        if (device.label.toLowerCase().includes('back')) score += 3;

        if (score > highestScore) {
          highestScore = score;
          bestDevice = device;
        }
      } catch {
        // Skip device if we can't test it
      }
    }

    if (bestDevice) return bestDevice;

    return (
      videoInputDevices.find((d) => d.label.toLowerCase().includes('back')) || videoInputDevices[0]
    );
  }
}
