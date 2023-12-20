import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export async function replaceTextInFile(searchBlock: string, replacementBlock: string, filePath: string) {
  try {
    let fullpath = path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, filePath);

    // Read the contents of the file
    let data = await fs.promises.readFile(fullpath, 'utf8');

    // Replace the block of text
    const updatedData = data.replace(searchBlock, replacementBlock);

    // Write the updated content back to the file
    await fs.promises.writeFile(fullpath, updatedData, 'utf8');

    console.log('File updated successfully.');
  } catch (err) {
    console.error('Error occurred:', err);
  }
}

export async function writeToFile(text: string, filePath: string){
  try {
    let fullpath = path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, filePath);
    await fs.promises.writeFile(fullpath, text, 'utf-8');
    console.log("File updated successfully");
  } catch (err) {
    console.error('Error occurred: ', err);
  }
}
