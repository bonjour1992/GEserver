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

/*
 * Enregistre une image dans ./public.
 *
 * Le chemin fourni par le client doit rester dans ./public
 * et avoir une extension d'image autorisée.
 * Retourne false si le chemin est refusé.
 */
export async function saveImage(req) {
    const relativePath = req.query.path;

    if (typeof relativePath !== "string" || !relativePath.trim()) {
        return false;
    }

    const baseDir = path.resolve("./public");
    const filePath = path.resolve(baseDir, relativePath);

    // Interdit de sortir de ./public (../, chemin absolu, autre lecteur)
    const rel = path.relative(baseDir, filePath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        return false;
    }

    const ext = path.extname(filePath).slice(1).toLowerCase();
    if (!options.extensions.includes(ext)) {
        return false;
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return false;
    }

    // Crée les dossiers si nécessaire
    await fs.mkdir(path.dirname(filePath), {
        recursive: true
    });

    // req.body est un Buffer
    await fs.writeFile(filePath, req.body);

    return true;
}