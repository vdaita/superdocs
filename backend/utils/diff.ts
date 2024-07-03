import { ratio as fuzzRatio } from 'fuzzball';
import { distance, closest } from 'fastest-levenshtein';

class Match {
    constructor(
        public block: string,
        public score: number
    ) {}
}

class Hunk {
    constructor(
        public filepath: string,
        public text: string
    ) {}
}

class SearchReplaceChange {
    constructor(
        public filepath: string,
        public searchBlock: string,
        public replaceBlock: string
    ) {}
}

function lineRelevant(line: string): boolean {
    return !(line.trim().length === 0 || line.startsWith("#") || line.startsWith("//"));
}

function findHunks(diffString: string): Hunk[] {
    const hunks: Hunk[] = [];
    let currentFilename = "";
    let currentLines = "";

    for (const line of diffString.split("\n")) {
        if (line.startsWith("---")) {
            continue;
        } else if (line.trim().startsWith("+++")) {
            if (currentFilename.length > 0) {
                hunks.push(new Hunk(currentFilename, currentLines));
            }
            currentFilename = line.slice(3).trim();
            currentLines = "";
        } else if (line.trim().startsWith("@@")) {
            if (currentFilename.length > 0) {
                hunks.push(new Hunk(currentFilename, currentLines));
            }
            currentLines = "";
        } else {
            currentLines += line + "\n";
        }
    }
    hunks.push(new Hunk(currentFilename, currentLines));
    return hunks;
}

function parseDiff(diffString: string): SearchReplaceChange[] {
    const hunks = findHunks(diffString);
    const searchReplaceBlocks: SearchReplaceChange[] = [];

    for (const hunk of hunks) {
        const filepath = hunk.filepath;
        const text = hunk.text;

        let searchBlock = "";
        let replaceBlock = "";

        for (const line of text.split("\n")) {
            if (line.startsWith("-")) {
                searchBlock += " " + line.slice(1) + "\n";
            } else if (line.startsWith("+")) {
                replaceBlock += " " + line.slice(1) + "\n";
            } else {
                searchBlock += line.slice(1) + "\n";
                replaceBlock += line.slice(1) + "\n";
            }
        }

        searchReplaceBlocks.push(new SearchReplaceChange(filepath, searchBlock, replaceBlock));
    }

    return searchReplaceBlocks;
}

function findBestMatch(queryCode: string, originalCode: string): Match {
    queryCode = queryCode.trim();

    const originalLines = originalCode.split("\n");
    const queryLines = queryCode.split("\n");

    if (queryLines.length === 0) {
        return new Match("THISSTRINGWILLNEVERBEFOUND", 100);
    }

    let bestMatch = new Match("", -1);

    for (let startLine = 0; startLine < originalLines.length; startLine++) {
        const minEnd = Math.min(originalLines.length, Math.max(startLine, startLine + queryLines.length - 5));
        const maxEnd = Math.min(originalLines.length, startLine + queryLines.length + 5);

        for (let endLine = minEnd; endLine < maxEnd; endLine++) {
            const fullOriginalSnippet = originalLines.slice(startLine, endLine + 1).join("\n");

            const snippetFromOriginal = originalLines.slice(startLine, endLine + 1).filter(lineRelevant).join("\n");
            const snippetFromQuery = queryLines.filter(lineRelevant).join("\n");

            const strippedOriginal = snippetFromOriginal.split("\n").map(line => line.trim()).join(" ");
            const strippedQuery = snippetFromQuery.split("\n").map(line => line.trim()).join(" ");

            let score = fuzzRatio(strippedOriginal, strippedQuery);

            score += 3 * fuzzRatio(originalLines[startLine], queryLines[0]);
            score += 3 * fuzzRatio(originalLines[endLine], queryLines[queryLines.length - 1]);

            if (score > bestMatch.score) {
                bestMatch = new Match(fullOriginalSnippet, score);
            }
        }
    }

    return bestMatch;
}

function extractCodeBlockData(mdText: string, language: string): string[] {
    const startDelimiter = `\`\`\`${language}`;
    const endDelimiter = `\`\`\``;
    const blocks: string[] = [];

    let startIndex = 0;
    while ((startIndex = mdText.indexOf(startDelimiter, startIndex)) !== -1) {
        const endIndex = mdText.indexOf(endDelimiter, startIndex + startDelimiter.length);
        if (endIndex === -1) break;

        const block = mdText.slice(startIndex + startDelimiter.length, endIndex).trim();
        blocks.push(block);
        startIndex = endIndex + endDelimiter.length;
    }

    return blocks;
}

export function getFixedSearchReplace(files: Map<string, string>, diffMd: string): SearchReplaceChange[]{
    let filenames = Array.from(files.keys());
    let diffBlocks = extractCodeBlockData(diffMd, "");
    let changes: SearchReplaceChange[] = [];
    diffBlocks.forEach((diffBlock) => {
        let parsedDiff = parseDiff(diffBlock);
        parsedDiff.forEach((srBlock) => {
            let matchedFilename = closest(srBlock.filepath, filenames);
            if(fuzzRatio(matchedFilename, srBlock.filepath) < 0.6){
                changes.push(srBlock); // This is probably a new file or something along those lines.
            } else{
                let matchedSearch = findBestMatch(srBlock.searchBlock, files.get(matchedFilename)!);
                changes.push(
                    new SearchReplaceChange(
                        matchedFilename,
                        matchedSearch.block,
                        srBlock.replaceBlock
                    )
                );
            }
        });
    });

    return changes;
}
