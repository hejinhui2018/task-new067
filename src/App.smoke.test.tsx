import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import App from './App';

describe('App 冒烟（双场地整树装配）', () => {
  it('服务端渲染不抛错，且包含两个场地与资源台账', () => {
    const html = renderToString(<App />);
    expect(html).toContain('双场地联排');
    expect(html).toContain('主舞台');
    expect(html).toContain('访谈间');
    expect(html).toContain('共享资源台账');
    // 双场地示例中的关键环节
    expect(html).toContain('采访·林澜');
    expect(html).toContain('联合对谈');
  });
});
