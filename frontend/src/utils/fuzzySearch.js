const collapseWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export const normalizeSearchText = (value) => {
  const collapsed = collapseWhitespace(value);
  if (!collapsed) return '';
  return collapsed
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
};

export const compactSearchText = (value) =>
  normalizeSearchText(value).replace(/[^a-z0-9]/g, '');

const tokenize = (value) =>
  normalizeSearchText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);

const extractNumberGroups = (compactValue) =>
  String(compactValue || '')
    .match(/\d+/g) || [];

const normalizeNumberToken = (value) =>
  String(value || '')
    .replace(/^0+(?=\d)/, '')
    .trim();

const numericGroupMatchesToken = (group, token) => {
  const left = normalizeNumberToken(group);
  const right = normalizeNumberToken(token);
  if (!left || !right) return false;
  if (left === right) return true;

  // Support partial numeric hall queries like "hall 2" -> hall20/hall21/hall22.
  if (right.length === 1) return left.startsWith(right);
  return false;
};

export const buildSearchNeedle = (query) => {
  const normalized = normalizeSearchText(query);
  return {
    raw: String(query || ''),
    normalized,
    compact: compactSearchText(normalized),
    tokens: tokenize(normalized)
  };
};

const levenshteinDistance = (aRaw, bRaw, maxDistance = Number.POSITIVE_INFINITY) => {
  const a = String(aRaw || '');
  const b = String(bRaw || '');
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  if (Math.abs(a.length - b.length) > maxDistance) {
    return maxDistance + 1;
  }

  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let minInRow = curr[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
      if (curr[j] < minInRow) minInRow = curr[j];
    }

    if (minInRow > maxDistance) {
      return maxDistance + 1;
    }

    const swap = prev;
    prev = curr;
    curr = swap;
  }

  return prev[b.length];
};

const diceCoefficient = (aRaw, bRaw) => {
  const a = String(aRaw || '');
  const b = String(bRaw || '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) {
    return a === b ? 1 : 0;
  }

  const grams = new Map();
  for (let i = 0; i < a.length - 1; i += 1) {
    const gram = a.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2);
    const count = grams.get(gram) || 0;
    if (count > 0) {
      grams.set(gram, count - 1);
      intersection += 1;
    }
  }

  return (2 * intersection) / ((a.length - 1) + (b.length - 1));
};

const bestTokenScore = (queryToken, candidateTokens) => {
  if (!queryToken || !candidateTokens.length) return 0;

  let best = 0;
  for (const token of candidateTokens) {
    if (!token) continue;
    if (token === queryToken) return 1;
    if (token.includes(queryToken) || queryToken.includes(token)) {
      if (0.92 > best) best = 0.92;
      continue;
    }

    const maxDistance = queryToken.length <= 4 ? 1 : queryToken.length <= 8 ? 2 : 3;
    if (Math.abs(token.length - queryToken.length) > maxDistance + 1) continue;
    const distance = levenshteinDistance(queryToken, token, maxDistance);
    if (distance <= maxDistance) {
      const similarity = 1 - (distance / Math.max(queryToken.length, token.length));
      const score = 0.55 + (similarity * 0.35);
      if (score > best) best = score;
    }
  }

  return best;
};

const scoreNormalizedCandidate = (needle, candidateNormalized) => {
  if (!needle?.normalized || !candidateNormalized) return 0;
  const candidateCompact = compactSearchText(candidateNormalized);

  let score = 0;
  if (candidateNormalized === needle.normalized) score = 1;
  if (needle.compact && candidateCompact === needle.compact) score = Math.max(score, 0.99);

  if (needle.normalized.length >= 2 && candidateNormalized.includes(needle.normalized)) {
    score = Math.max(score, 0.97);
  }
  if (needle.compact.length >= 2 && candidateCompact.includes(needle.compact)) {
    score = Math.max(score, 0.95);
  }

  if (candidateNormalized.length >= 3 && needle.normalized.includes(candidateNormalized)) {
    score = Math.max(score, 0.84);
  }

  if (needle.tokens.length > 0) {
    const candidateTokens = tokenize(candidateNormalized);
    if (candidateTokens.length > 0) {
      let tokenSum = 0;
      for (const qToken of needle.tokens) {
        tokenSum += bestTokenScore(qToken, candidateTokens);
      }
      const tokenAverage = tokenSum / needle.tokens.length;
      score = Math.max(score, 0.35 + (tokenAverage * 0.6));
    }
  }

  if (needle.compact.length >= 2 && candidateCompact.length >= 2) {
    const dice = diceCoefficient(needle.compact, candidateCompact);
    score = Math.max(score, dice * 0.85);
  }

  return Math.max(0, Math.min(1, score));
};

export const fuzzyScore = (needleOrQuery, candidate) => {
  const needle =
    typeof needleOrQuery === 'string'
      ? buildSearchNeedle(needleOrQuery)
      : needleOrQuery;
  if (!needle?.normalized) return 0;
  return scoreNormalizedCandidate(needle, normalizeSearchText(candidate));
};

const toFieldArray = (fields) => {
  if (Array.isArray(fields)) return fields;
  return [fields];
};

export const fuzzyScoreFromFields = (needleOrQuery, fields) => {
  const needle =
    typeof needleOrQuery === 'string'
      ? buildSearchNeedle(needleOrQuery)
      : needleOrQuery;
  if (!needle?.normalized) return 0;

  return toFieldArray(fields).reduce((best, value) => {
    const next = fuzzyScore(needle, value);
    return next > best ? next : best;
  }, 0);
};

export const fuzzyFilter = (items, query, pickFields, options = {}) => {
  const needle = buildSearchNeedle(query);
  if (!needle.normalized) return Array.isArray(items) ? items : [];

  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.5;
  const source = Array.isArray(items) ? items : [];
  return source.filter((item) => {
    const fields = typeof pickFields === 'function' ? pickFields(item) : item;
    return fuzzyScoreFromFields(needle, fields) >= threshold;
  });
};

export const fuzzyFilterAndRank = (items, query, pickFields, options = {}) => {
  const needle = buildSearchNeedle(query);
  const source = Array.isArray(items) ? items : [];
  if (!needle.normalized) return source;

  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.5;
  return source
    .map((item, index) => {
      const fields = typeof pickFields === 'function' ? pickFields(item) : item;
      return {
        item,
        index,
        score: fuzzyScoreFromFields(needle, fields)
      };
    })
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
};

export const fuzzyFilterHallLike = (
  items,
  query,
  pickName,
  pickExtraFields = () => [],
  options = {}
) => {
  const needle = buildSearchNeedle(query);
  const source = Array.isArray(items) ? items : [];
  if (!needle.normalized) return source;

  const normalizedQuery = needle.normalized;
  const compactQuery = needle.compact;
  const hasAlpha = /[a-z]/i.test(normalizedQuery);
  const numericTokensRaw = (normalizedQuery.match(/\d+/g) || []).filter(Boolean);
  const compactNumericTokens = extractNumberGroups(compactQuery);
  const numericTokens = (compactNumericTokens.length > 0 ? compactNumericTokens : numericTokensRaw)
    .map(normalizeNumberToken)
    .filter(Boolean);
  const compactNameFor = (item) => compactSearchText(pickName(item));
  const normalizedNameFor = (item) => normalizeSearchText(pickName(item));
  const nameThreshold = Number.isFinite(options.nameThreshold) ? options.nameThreshold : 0.4;
  const baseThreshold = Number.isFinite(options.threshold) ? options.threshold : 0.46;

  // Prefer direct compact/normalized containment when available.
  // This guarantees "hall 20" immediately maps to "hall20".
  const directNameMatches = source.filter((item) => {
    const compactName = compactNameFor(item);
    const normalizedName = normalizedNameFor(item);
    if (!compactName && !normalizedName) return false;
    if (compactQuery && compactName.includes(compactQuery)) return true;
    if (normalizedQuery && normalizedName.includes(normalizedQuery)) return true;
    return false;
  });

  // Mixed alphanumeric hall queries (e.g. "hall 20") should map to hall names
  // containing the same numeric fragments, not every hall with "hall" token.
  if (hasAlpha && numericTokens.length > 0) {
    const strictSource = directNameMatches.length > 0
      ? directNameMatches
      : fuzzyFilterAndRank(
        source,
        query,
        (item) => [pickName(item)],
        { threshold: nameThreshold }
      );

    return strictSource.filter((item) => {
      const compactName = compactNameFor(item);
      const nameNumbers = extractNumberGroups(compactName).map(normalizeNumberToken);
      return numericTokens.every((token) =>
        nameNumbers.some((group) => numericGroupMatchesToken(group, token))
      );
    });
  }

  if (directNameMatches.length > 0) {
    return directNameMatches;
  }

  return fuzzyFilterAndRank(
    source,
    query,
    (item) => [pickName(item), ...toFieldArray(pickExtraFields(item))],
    { threshold: baseThreshold }
  );
};
