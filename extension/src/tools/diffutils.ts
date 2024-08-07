import * as fuzz from 'fuzzball';
import * as Diff from 'diff';

class Hunk {
    filepath: string;
    text: string;

    constructor(filepath: string, text: string) {
        this.filepath = filepath;
        this.text = text;
    }
}

class SearchReplaceChange {
    filepath: string;
    searchBlock: string;
    replaceBlock: string;

    constructor(filepath: string, searchBlock: string, replaceBlock: string) {
        this.filepath = filepath;
        this.searchBlock = searchBlock;
        this.replaceBlock = replaceBlock;
    }
}

function findHunks(diffString: string) {
    const hunks = [];
    let currentFilename = "";
    let currentLines = "";
    const lines = diffString.split('\n');

    lines.forEach((line) => {
        if (line.startsWith('---')) {
            // skip
        } else if (line.startsWith('+++')) {
            if (currentFilename.length > 0) {
                hunks.push(new Hunk(currentFilename, currentLines));
            }
            currentFilename = line.slice(3);
            currentLines = "";
        } else if (line.startsWith('@@')) {
            if (currentFilename.length > 0) {
                hunks.push(new Hunk(currentFilename, currentLines));
            }
            currentLines = "";
        } else {
            currentLines += line + "\n";
        }
    });

    hunks.push(new Hunk(currentFilename, currentLines));
    return hunks;
}

export function parseDiff(diffString: string) {
    const hunks = findHunks(diffString);
    const searchReplaceBlocks: SearchReplaceChange[] = [];

    hunks.forEach((hunk) => {
        const filepath = hunk.filepath;
        const text = hunk.text;

        let searchBlock = "";
        let replaceBlock = "";

        const lines = text.split('\n');
        lines.forEach((line) => {
            if (line.startsWith('-')) {
                searchBlock += line.slice(1) + "\n";
            } else if (line.startsWith('+')) {
                replaceBlock += line.slice(1) + "\n";
            } else {
                searchBlock += line.slice(1) + "\n";
                replaceBlock += line.slice(1) + "\n";
            }
        });

        searchReplaceBlocks.push(new SearchReplaceChange(filepath, searchBlock, replaceBlock));
    });

    return searchReplaceBlocks;
}

class Match {
    block: string;
    score: number;

    constructor(block: string, score: number) {
        this.block = block;
        this.score = score;
    }
}

function lineRelevant(line: string) {
    const trimmed = line.trim();
    return !(trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('//'));
}

export function findBestMatch(queryCode: string, originalCode: string) {
    queryCode = queryCode.trim();

    const originalLines = originalCode.split('\n');
    const queryLines = queryCode.split('\n');

    if (queryLines.length === 0) {
        return new Match("SUPERDOCSTHISSTRINGWILLNEVEREVERBEFOUND", 100);
    }

    let bestMatch = new Match("", -1);

    for (let startLine = 0; startLine < originalLines.length; startLine++) {
        const minEnd = Math.min(originalLines.length, Math.max(startLine, startLine + queryLines.length - 5));
        const maxEnd = Math.min(originalLines.length, startLine + queryLines.length + 5);

        for (let endLine = minEnd; endLine < maxEnd; endLine++) {
            const fullOriginalSnippet = originalLines.slice(startLine, endLine + 1).join('\n');

            const snippetFromOriginal = originalLines.slice(startLine, endLine + 1).filter(lineRelevant).join('\n');
            const snippetFromQuery = queryLines.filter(lineRelevant).join('\n');

            const strippedOriginal = snippetFromOriginal.split('\n').map(line => line.trim()).join(' ');
            const strippedQuery = snippetFromQuery.split('\n').map(line => line.trim()).join(' ');

            let score = fuzz.ratio(strippedOriginal, strippedQuery);

            score += 3 * fuzz.ratio(originalLines[startLine], queryLines[0]);
            score += 3 * fuzz.ratio(originalLines[endLine], queryLines[queryLines.length - 1]);

            if (score > bestMatch.score) {
                bestMatch = new Match(fullOriginalSnippet, score);
            }
        }
    }
    return bestMatch;
}

export function createSRBlocks(oldFile: string, newFile: string): string{
    let generatedDiff = Diff.createPatch("main.py",  oldFile, newFile);
    let searchReplaceChanges = parseDiff(generatedDiff);
    let fixedFile = oldFile;
    for(var i = 0; i < searchReplaceChanges.length; i++){
        if (searchReplaceChanges[i].searchBlock.length == 0) {
            continue;
        }

        searchReplaceChanges[i].searchBlock = findBestMatch(searchReplaceChanges[i].searchBlock, oldFile).block;
        fixedFile = fixedFile.replace(searchReplaceChanges[i].searchBlock, `<<<<<<< SEARCH
${searchReplaceChanges[i].searchBlock}
=======
${searchReplaceChanges[i].replaceBlock.trimEnd()}
>>>>>>> REPLACE`)
    }

    return fixedFile;
}