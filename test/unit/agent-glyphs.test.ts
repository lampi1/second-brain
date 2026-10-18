// Registry, renderer, persistence boundary and measured contrast checks for designed role identities.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AGENT_SYMBOLS, AGENT_TONES, type AgentProfile } from '../../src/shared/agents';
import { ROLE_GLYPHS } from '../../src/shared/agent-glyphs';
import { AgentGlyph } from '../../src/renderer/components/AgentGlyphs';
import { AgentAvatar } from '../../src/renderer/components/AgentAvatar';
import { GLYPH_ART, GLYPH_SIZES } from '../../src/renderer/lib/agent-glyph-art';
import { GLYPH_INK, GLYPH_TONES } from '../../src/renderer/lib/agent-glyph-tones';
import { duplicateAgentAvatars, unusedAgentTone } from '../../src/renderer/lib/agent-avatar-choice';

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/../g)!.map(v => parseInt(v,16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
  return rgb[0]!*.2126 + rgb[1]!*.7152 + rgb[2]!*.0722;
}
function contrast(a: string,b: string) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
describe('designed role glyphs', () => {
  it('registers 24 distinct trusted motifs in the persistence allowlist', () => {
    expect(ROLE_GLYPHS).toHaveLength(24);
    expect(new Set(Object.values(GLYPH_ART).map(a => a.outline)).size).toBe(24);
    for (const id of ROLE_GLYPHS) expect(AGENT_SYMBOLS).toContain(id);
  });
  it('renders each optical size without executable markup, and falls back on unknown IDs', () => {
    for (const symbol of ROLE_GLYPHS) for (const size of GLYPH_SIZES) {
      const html=renderToStaticMarkup(createElement(AgentGlyph,{symbol,size}));
      expect(html).toContain(`data-glyph-size="${size}"`);
      expect(html).toContain('opacity=".3"');
      expect(html).not.toMatch(/<script|<image|href=|<foreignObject/);
    }
    expect(renderToStaticMarkup(createElement(AgentGlyph,{symbol:'<script>'}))).toContain('data-glyph="role-spark"');
    const small=renderToStaticMarkup(createElement(AgentGlyph,{symbol:'role-research',size:16}));
    expect(small).not.toContain(GLYPH_ART['role-research'].detail);
  });
  it('preserves legacy preset rendering, renders new badges and labels the avatar only once', () => {
    const old=renderToStaticMarkup(createElement(AgentAvatar,{avatar:{kind:'symbol',value:'code'},name:'Dev'}));
    expect(old).not.toContain('data-glyph=');
    const next=renderToStaticMarkup(createElement(AgentAvatar,{avatar:{kind:'symbol',value:'role-implementer',tone:'teal'},name:'Dev'}));
    expect(next).toContain('data-glyph="role-implementer"');
    expect(next.match(/role="img"/g)).toHaveLength(1);
    expect(next).toContain('data-shadow="true"');
  });
  it('passes 3:1 badge/background and 4.5:1 outline/badge for every tone and gradient sample', () => {
    for(const theme of ['dark','light'] as const) for(const tone of AGENT_TONES) {
      const [a,b]=GLYPH_TONES[tone][theme];
      for(let step=0;step<=10;step++) {
        const color='#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-step/10)+parseInt(b.slice(i,i+2),16)*step/10).toString(16).padStart(2,'0')).join('');
        for(const background of theme==='dark'?['#101114','#191a1f','#30333c']:['#ffffff','#f3f4f7','#e2e5eb']) expect(contrast(color,background),`${theme}/${tone}/${background}`).toBeGreaterThanOrEqual(3);
        expect(contrast(color,GLYPH_INK[theme]),`${theme}/${tone}/ink`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('warns for exact identities across categories, excludes self and suggests an unused category tone', () => {
    const p={id:'one',name:'One',category:'development',avatar:{kind:'symbol',value:'role-ops'}} as AgentProfile;
    expect(duplicateAgentAvatars({kind:'symbol',value:'role-ops',tone:'blue'},[p])).toEqual([p]);
    expect(duplicateAgentAvatars(p.avatar,[p],'one')).toEqual([]);
    expect(duplicateAgentAvatars({kind:'symbol',value:'role-ops',tone:'red'},[p])).toEqual([]);
    expect(duplicateAgentAvatars({kind:'image',dataUrl:'x'},[p])).toEqual([]);
    expect(unusedAgentTone([p],'development')).toBe('violet');
    expect(unusedAgentTone([p],'personal')).toBe('blue');
  });
});
