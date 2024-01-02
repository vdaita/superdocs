import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export async function replaceTextInFile(searchBlock: string, replacementBlock: string, filePath: string) {
  try {
    let fullpath = filePath;

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

export async function writeToFile(data: string, filePath: string) {
  try {
    // Split the file path into directory and filename
    let splitPath = filePath.split('/');
    let fileName = splitPath.pop();
    let dirPath = splitPath.join('/');

    // Create directory if it doesn't exist
    if (!fs.existsSync(dirPath)){
        fs.mkdirSync(dirPath, { recursive: true });
    }

    if(!fileName){
      throw "fileName is empty in writeToFile";
    }

    // Write data to file
    await fs.promises.writeFile(filePath, data, 'utf8');

    console.log(`Data written to ${fileName}`);
  } catch (err) {
    console.error("Error occurred: ", err);
  }
}