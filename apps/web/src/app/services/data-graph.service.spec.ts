import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DataGraphService } from './data-graph.service';

const graph = (label: string) => ({
  nodes: [{ id: label, kind: 'topic', label }],
  links: [],
  status: { modelLinks: false },
});
describe('DataGraphService date requests', () => {
  it('sends the window and ignores both late replies and late errors for an older window', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const service = TestBed.inject(DataGraphService);
    const http = TestBed.inject(HttpTestingController);
    const old = service.load('nb', { from: 10 });
    const a = http.expectOne('/api/graph/nb?from=10');
    const current = service.load('nb', { from: 20, to: 30 });
    const b = http.expectOne('/api/graph/nb?from=20&to=30');
    a.flush(graph('old'));
    await old;
    expect(service.loading()).toBe(true);
    expect(service.graph()).toBeNull();
    b.flush({ graph: graph('current') });
    await current;
    expect(service.graph()?.nodes[0]?.label).toBe('current');
    const earlier = service.load('nb', { from: 40 });
    const c = http.expectOne('/api/graph/nb?from=40');
    const latest = service.load('nb', { from: 50 });
    const d = http.expectOne('/api/graph/nb?from=50');
    d.flush({ graph: graph('latest') });
    await latest;
    c.flush({ message: 'old failure' }, { status: 500, statusText: 'Failure' });
    await earlier;
    expect(service.error()).toBeNull();
    expect(service.graph()?.nodes[0]?.label).toBe('latest');
    expect(service.loading()).toBe(false);
    http.verify();
  });
});
