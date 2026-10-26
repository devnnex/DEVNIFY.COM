import 'fake-indexeddb/auto';
import { vi } from 'vitest';
vi.stubGlobal('document', {
  createElement: () => ({ canPlayType: () => 'probably' }),
});
