import * as fs from 'fs';

async function replaceTextInFile(searchBlock: string, replacementBlock: string, filePath: string) {
  try {
    // Read the contents of the file
    let data = await fs.promises.readFile(filePath, 'utf8');

    // Replace the block of text
    const updatedData = data.replace(searchBlock, replacementBlock);

    // Write the updated content back to the file
    await fs.promises.writeFile(filePath, updatedData, 'utf8');

    console.log('File updated successfully.');
  } catch (err) {
    console.error('Error occurred:', err);
  }
}

export default replaceTextInFile;