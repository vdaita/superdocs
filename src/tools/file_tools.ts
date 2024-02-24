import * as fs from 'fs/promises';
import * as child_process from 'child_process';
import * as path from 'path';
import * as os from 'os';

export class FileTools {
    baseDirectory: string;

    constructor(baseDirectory: string) {
        this.baseDirectory = baseDirectory;
    }

    async listDirectory(subDirectory: string): Promise<string[]> {
        const fullPath = path.join(this.baseDirectory, subDirectory);
        const files = await fs.readdir(fullPath, { withFileTypes: true });
        const nonIgnoredFiles = files.filter(file => !file.isFile() || !file.name.startsWith('.gitignore'));
        return nonIgnoredFiles.map(file => file.name);
    }
       
    // async fileSearch(query: string): Promise<string[]> {
    //     const command = os.platform() === 'win32' ? 'findstr' : 'grep';
    //     const { stdout } = await child_process.exec(`${command} -r "${query}" ${this.baseDirectory}`);
    //     return stdout!.split('\n');
    // }
    
    async writeFile(filePath: string, content: string): Promise<void> {
        const fullPath = path.join(this.baseDirectory, filePath);
        await fs.writeFile(fullPath, content);
    }
       
    async readFile(filePath: string): Promise<string> {
        const fullPath = path.join(this.baseDirectory, filePath);
        const content = await fs.readFile(fullPath, 'utf-8');
        return content;
    }
       
    async replaceTextInFile(filePath: string, originalText: string, replacementText: string): Promise<void> {
        const content = await this.readFile(filePath);
        const newContent = content.replace(originalText, replacementText);
        await this.writeFile(filePath, newContent);
    }   
}

export async function replaceTextInFile(searchBlock: string, replacementBlock: string, filePath: string) {
    try {
      // Read the contents of the file
      let data = await fs.readFile(filePath, 'utf8');
  
      // Replace the block of text
      const updatedData = data.replace(searchBlock, replacementBlock);
  
      // Write the updated content back to the file
      await fs.writeFile(filePath, updatedData, 'utf8');
  
      console.log('File updated successfully.');
    } catch (err) {
      console.error('Error occurred:', err);
    }
}