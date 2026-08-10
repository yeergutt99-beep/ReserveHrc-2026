const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { recursivelyDeleteConversation } = require('../conversation-cleanup');

test('elimina recursivamente el chat y toda su subcoleccion de mensajes', async () => {
  const conversationRef = { path: 'companies/hrc-ushuaia/sofiaConversations/5492901000000' };
  const deleted = [];
  const db = {
    async recursiveDelete(ref) {
      deleted.push(ref);
    }
  };

  assert.equal(await recursivelyDeleteConversation(db, conversationRef), true);
  assert.deepEqual(deleted, [conversationRef]);
});

test('una eliminacion sin snapshot no falla ni intenta borrar otra ruta', async () => {
  let calls = 0;
  const db = {
    async recursiveDelete() {
      calls += 1;
    }
  };

  assert.equal(await recursivelyDeleteConversation(db, undefined), false);
  assert.equal(calls, 0);
});

test('el trigger escucha solo conversaciones de Sofia eliminadas', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(
    source,
    /cleanupDeletedSofiaConversationMessages = onDocumentDeleted\([\s\S]*companies\/\{companyId\}\/sofiaConversations\/\{senderId\}/
  );
  assert.match(source, /recursivelyDeleteConversation\(db, event\.data\?\.ref\)/);
});
