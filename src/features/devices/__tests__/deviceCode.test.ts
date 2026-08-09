import {
  codeMatchesDevice,
  isPlausibleCode,
  matchDevices,
  MIN_CODE_LENGTH,
  normaliseCode,
  printedCode,
} from '../deviceCode';

const TAGS = [
  { id: '48:87:2D:9D:C0:0C', name: 'CP27-C00C' },
  { id: '48:87:2D:9D:C0:47', name: 'CP27-C047' },
  { id: '48:87:2D:9D:C0:11', name: 'CP27-C011' },
  { id: '48:87:2D:9C:FB:0F', name: 'CP27-FB0F' },
];

describe('normaliseCode', () => {
  it('reduces anything printed on the tag to hex digits', () => {
    // The CP27 product prefix is stripped, so pasting the whole printed name
    // yields exactly the code — not "C27C00C".
    expect(normaliseCode('CP27-C00C')).toBe('C00C');
    expect(normaliseCode('c0:0c')).toBe('C00C');
    expect(normaliseCode('48:87:2D:9D:C0:0C')).toBe('4887 2D9D C00C'.replace(/ /g, ''));
  });
});

describe('isPlausibleCode', () => {
  it('accepts the four digits printed on the tag', () => {
    expect(isPlausibleCode('C00C')).toBe(true);
  });

  it('rejects something too short to identify a tag', () => {
    // Two digits would collide across a shelf of them.
    expect(isPlausibleCode('0C')).toBe(false);
    expect(isPlausibleCode('')).toBe(false);
    expect(MIN_CODE_LENGTH).toBeGreaterThan(2);
  });

  it('rejects prose, even though its letters happen to be hex digits', () => {
    // "left rod" reduces to E, F, D — three valid hex digits — so a filter that
    // merely discarded non-hex would accept it and could match a real tag.
    expect(isPlausibleCode('left rod')).toBe(false);
    expect(isPlausibleCode('the big one')).toBe(false);
  });

  it('accepts the whole printed name', () => {
    expect(isPlausibleCode('CP27-C00C')).toBe(true);
  });
});

describe('codeMatchesDevice', () => {
  it('matches the printed short code', () => {
    expect(codeMatchesDevice('C00C', '48:87:2D:9D:C0:0C')).toBe(true);
    expect(codeMatchesDevice('c00c', '48:87:2D:9D:C0:0C')).toBe(true);
  });

  it('matches the full MAC however it is punctuated', () => {
    expect(codeMatchesDevice('48:87:2D:9D:C0:0C', '48:87:2D:9D:C0:0C')).toBe(true);
    expect(codeMatchesDevice('48872d9dc00c', '48:87:2D:9D:C0:0C')).toBe(true);
  });

  it('matches via the advertised name', () => {
    expect(codeMatchesDevice('C00C', 'some-ios-uuid', 'CP27-C00C')).toBe(true);
  });

  it('matches only as a SUFFIX, never mid-address', () => {
    // "87" appears in 48:87:… but is not printed on that tag. A substring match
    // would silently bind the wrong one.
    expect(codeMatchesDevice('872D', '48:87:2D:9D:C0:0C')).toBe(false);
    expect(codeMatchesDevice('4887', '48:87:2D:9D:C0:0C')).toBe(false);
  });

  it('does not match a different tag', () => {
    expect(codeMatchesDevice('C047', '48:87:2D:9D:C0:0C')).toBe(false);
  });

  it('refuses a code below the minimum length', () => {
    expect(codeMatchesDevice('0C', '48:87:2D:9D:C0:0C')).toBe(false);
  });
});

describe('matchDevices', () => {
  it('finds the one tag a printed code identifies', () => {
    const found = matchDevices('C00C', TAGS);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe('48:87:2D:9D:C0:0C');
  });

  it('is case- and punctuation-insensitive', () => {
    expect(matchDevices('c0:0c', TAGS)[0]!.id).toBe('48:87:2D:9D:C0:0C');
  });

  it('matches the whole printed name', () => {
    expect(matchDevices('CP27-C047', TAGS)[0]!.id).toBe('48:87:2D:9D:C0:47');
  });

  it('rejects a code too short to identify a tag', () => {
    expect(matchDevices('0F', TAGS)).toHaveLength(0);
    expect(matchDevices('C0', TAGS)).toHaveLength(0);
  });

  it('surfaces a genuinely ambiguous code as multiple candidates', () => {
    const twins = [
      { id: 'AA:BB:CC:DD:C0:0C', name: 'CP27-C00C' },
      { id: '48:87:2D:9D:C0:0C', name: 'CP27-C00C' },
    ];
    expect(matchDevices('C00C', twins)).toHaveLength(2);
  });

  it('returns nothing for a code that matches no tag in range', () => {
    expect(matchDevices('DEAD', TAGS)).toHaveLength(0);
  });

  it('returns nothing for an unusable code', () => {
    expect(matchDevices('', TAGS)).toHaveLength(0);
    expect(matchDevices('xy', TAGS)).toHaveLength(0);
    expect(matchDevices('left rod', TAGS)).toHaveLength(0);
  });
});

describe('printedCode', () => {
  it('is what is written on the tag', () => {
    expect(printedCode('48:87:2D:9D:C0:0C')).toBe('C00C');
    expect(printedCode('48:87:2D:9D:C0:47')).toBe('C047');
  });
});
