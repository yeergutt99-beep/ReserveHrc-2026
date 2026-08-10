async function recursivelyDeleteConversation(db, conversationRef) {
  if (!conversationRef) return false;
  await db.recursiveDelete(conversationRef);
  return true;
}

module.exports = { recursivelyDeleteConversation };
