const STOP = new Set([
    'the',
    'a',
    'an',
    'is',
    'are',
    'was',
    'what',
    'when',
    'where',
    'who',
    'how',
    'does',
    'do',
    'did',
    'for',
    'to',
    'of',
    'in',
    'on',
    'and',
    'or',
    'my',
    'me',
    'i',
    'any',
    'there',
    'this',
    'that',
    'with',
    'about',
    'it',
    'be',
    'time',
]);
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
export function parseHybridQuery(text: string) {
    const required: string[] = [],
        excluded: string[] = [],
        bare: string[] = [];
    for (const raw of (text.slice(0, 500).match(/-?"[^"]*"|-?[^\s"]+/gu) ?? []).slice(0, 24)) {
        const negative = raw.startsWith('-');
        const token = negative ? raw.slice(1) : raw;
        const phrase = token.startsWith('"');
        const value = (phrase ? token.slice(1, -1) : token)
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .trim();
        if (!value) continue;
        if (negative) excluded.push(value);
        else if (phrase) required.push(value);
        else bare.push(value);
    }
    const useful = bare.filter((term) => !STOP.has(term));
    const terms = useful.length ? useful : bare;
    let expression = terms.length ? '(' + terms.map(quote).join(' OR ') + ')' : '';
    for (const phrase of required) expression += (expression ? ' AND ' : '') + quote(phrase);
    for (const word of excluded) if (expression) expression += ' NOT ' + quote(word);
    return {
        terms: [...terms, ...required],
        required,
        excluded,
        expression,
        requiredExpression: required.map(quote).join(' AND '),
        excludedExpression: excluded.map(quote).join(' OR '),
    };
}

export function fuseRanks(
    lexical: string[],
    semantic: string[],
): Array<{ id: string; score: number }> {
    const scores = new Map<string, number>();
    for (const list of [lexical, semantic])
        [...new Set(list)].forEach((id, rank) =>
            scores.set(id, (scores.get(id) ?? 0) + 1 / (61 + rank)),
        );
    return [...scores]
        .map(([id, score]) => ({ id, score }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
