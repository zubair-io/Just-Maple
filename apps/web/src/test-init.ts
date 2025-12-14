import '@angular/compiler';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { NgModule, provideZonelessChangeDetection } from '@angular/core';

const TESTBED_INIT_KEY = Symbol.for('angular-testbed-initialized');

// Only initialize once
if (!(globalThis as any)[TESTBED_INIT_KEY]) {
  (globalThis as any)[TESTBED_INIT_KEY] = true;

  @NgModule({
    providers: [provideZonelessChangeDetection()],
  })
  class ZonelessTestModule {}

  getTestBed().initTestEnvironment(
    [BrowserTestingModule, ZonelessTestModule],
    platformBrowserTesting(),
  );
}
