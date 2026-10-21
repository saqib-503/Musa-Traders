import {readFile,writeFile} from 'node:fs/promises';
// schema.sql includes the original tables followed by the ordered migrations.
const schema=await readFile('supabase/schema.sql','utf8');
const categories=await readFile('supabase/seed-categories.sql','utf8');
await writeFile('supabase/setup.sql', '-- FRESH DATABASE ONLY. Run existing-database migrations instead for an installed store.\n-- No demo products or users are inserted.\nbegin;\n'+schema.replace(/^\s*(begin|commit);\s*$/gmi,'')+'\n'+categories+'\ncommit;\n');
