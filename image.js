import * as dree from 'dree'
import fs from "fs/promises";
import path from "path";

const options = {
    depth: 10,
    // exclude: "",       // To exclude some pahts with a regexp
    extensions: ['svg', 'jpg', 'png', 'jpeg'],    // To include only some extensions
    stat: false,
    size: false,
};



export async function getImage() {
    let tree;
    tree = await dree.scanAsync('./public', options);
    return tree
}

export async function saveImage(req) {
    const relativePath = req.query.path;

    const baseDir = path.resolve("./public");
    const filePath = path.resolve(baseDir, relativePath);

    // Crée les dossiers si nécessaire
    await fs.mkdir(path.dirname(filePath), {
        recursive: true
    });

    // req.body est un Buffer
    await fs.writeFile(filePath, req.body);

}