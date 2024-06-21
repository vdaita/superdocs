import { FeatureExtractionPipeline, Pipeline, pipeline } from "@xenova/transformers";
import { HierarchicalNSW } from "hnswlib-node";
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

type Chunk = {
    filepath: string;
    chunkText: string;
    embedding: number[];
    lastUpdated: Date
}

class Vectorstore {
    workspaceDir: string;
    index: HierarchicalNSW;
    extractor?: FeatureExtractionPipeline;
    chunks: Chunk[];

    constructor(workspaceDir: string){
        this.workspaceDir = workspaceDir;
        this.index = new HierarchicalNSW("l2", 768);
        this.chunks = [];

        // See if there is already a cache file
        const slugify = (str: string) => str.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
        let slugifiedWorkspaceDir = slugify(workspaceDir);
        
        let homeDirectory = os.homedir();
        let cacheDirectory = path.join(homeDirectory, ".cache/superdocs");
        let fileCache = path.join(cacheDirectory, slugifiedWorkspaceDir + ".json");

    }

    convertStringToSlug(){

    }

    async loadModel(){
        this.extractor = await pipeline("feature-extraction", '',  {revision: 'default'});
    }

    async reloadIndex(){
        let validFiles: string[] = [];

        let fileLastModified = new Map<string, Date>();
        let filesToUpdate: string[] = [];
        let filesToDelete: string[] = [];

        this.chunks.forEach((chunk) => {
            fileLastModified.set(chunk.filepath, chunk.lastUpdated);
            if(!(validFiles.includes(chunk.filepath))){
                filesToDelete.push(chunk.filepath); // This filepath no longer exists.
            }
        });

        validFiles.forEach((file) => {
            let stats = fs.statSync(file);
            let modifiedTime = stats.mtime;

            // If the modified time of the chunks in the map are greater than 
            if(!fileLastModified.has(file)){
                filesToUpdate.push(file);
            } // else if (fileLastModified.get(file) < modifiedTime) {
            //    filesToUpdate.push(file);
            // }
        });
    }
}