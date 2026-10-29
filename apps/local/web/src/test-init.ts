import { webcrypto } from 'node:crypto';
import '@angular/compiler';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { NgModule, provideZonelessChangeDetection } from '@angular/core';

@NgModule({ providers: [provideZonelessChangeDetection()] })
class ZonelessTestModule {}
getTestBed().resetTestEnvironment();
getTestBed().initTestEnvironment(
  [BrowserTestingModule, ZonelessTestModule],
  platformBrowserTesting(),
);

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
