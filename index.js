const fs = require('fs');
const path = require('path');
const yargs = require('yargs');
const { pick } = require('lodash');
const { PSTMessage, PSTFile, PSTFolder } = require('pst-extractor');
const isemail = require('isemail');
const csvWriter = require('csv-write-stream');
const uniq = require('unique-hash-stream');

const { pstfile, csvfile, folder } = yargs
    .usage('$0 [options]')
    .demand('pstfile')
    .demand('csvfile')
    .option('folder')
    .wrap(yargs.terminalWidth())
    .help()
    .argv;

const pst = new PSTFile(path.resolve(pstfile));

const rootFolder = pst.getRootFolder().getSubFolders()[0];

if (folder === undefined) {
    console.log('Missing --folder option. Available folders:');
    console.log(rootFolder.getSubFolders().map(f => f.displayName));
    process.exit();
}

const selectedFolder = folder
    ? navigate(rootFolder, folder)
    : rootFolder;

console.log('Extracting contacts from folder', selectedFolder.displayName);

const csvStream = csvWriter()
    .on('error', handleError);

csvStream
    .pipe(uniq(data => data.split(',')[0])) // unique by email address
    .on('error', handleError)
    .pipe(fs.createWriteStream(path.resolve(csvfile)))
    .on('error', handleError);

if (selectedFolder.contentCount > 0) {
    while (email = selectedFolder.getNextChild()) {
        const data = transform({
            ...pick(email.toJSON(), ['senderEmailAddress', 'senderName', 'subject']),
            body: email.body
        });

        if (isemail.validate(data.senderEmailAddress)) {
            csvStream.write(data);
        }
    }
}

csvStream.end();

function navigate(current, folder = '') {
    const levels = folder.split('/');
    
    if (levels.length === 0) {
        return current;
    }
    
    if (!current.hasSubfolders) {
        throw new Error(`PST folder not found: "${folder}"`)
    }
    
    const currentLevel = levels[0];
    const nextLevels = levels.slice(1);
    const foundFolder = current.getSubFolders().find(f => f.displayName === currentLevel);

    if (!foundFolder) {
        throw new Error(`PST folder not found: "${folder}"`);
    }

    return nextLevels.length > 0
        ? navigate(foundFolder, nextLevels)
        : foundFolder;
}

function transform({ senderEmailAddress, senderName, subject, body }) {
    let senderFirstName = '',
        senderLastName = '',
        address = '',
        senderStreet = '',
        senderCity = '',
        senderState = '',
        senderZip = '',
        senderPhone = '';

    try {
        [ senderFirstName, senderLastName ] = /Website email from (.*)$/.exec(subject)[1].split(' ');
    } catch(e) {
        // ignore
    }

    const addressParser = new RegExp(`${senderFirstName} ${senderLastName}((.*\\r\\n)*)$`);

    try {
        address = addressParser.exec(body)[1].trim().split('\r\n');
        senderPhone = address.pop();
        [ senderStreet, address ] = address;
        [, senderCity, senderState, senderZip ] = /(.*), (\w{2}) (\d{5})/.exec(address);
    } catch(e) {
        // ignore
    }
    
    return {
        senderEmailAddress,
        senderFirstName,
        senderLastName,
        senderStreet,
        senderCity,
        senderState,
        senderZip,
        senderPhone
    };
}

function handleError(e) {
    console.error(e);
    process.exit(1);
}
