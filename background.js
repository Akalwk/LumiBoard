const QUICK_SAVE_FOLDER = 'LumiBoard Quick Saves';

function getTree() {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getTree(tree => {
      const err = chrome.runtime.lastError;
      if (err) reject(err); else resolve(tree);
    });
  });
}

function createBookmark(details) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.create(details, node => {
      const err = chrome.runtime.lastError;
      if (err) reject(err); else resolve(node);
    });
  });
}

function findFolder(nodes, name) {
  for (const node of nodes || []) {
    if (!node.url && node.title === name) return node;
    const found = findFolder(node.children, name);
    if (found) return found;
  }
  return null;
}

async function getOrCreateQuickSaveFolder(tree) {
  const existing = findFolder(tree, QUICK_SAVE_FOLDER);
  if (existing) return existing;

  // Chrome normally uses bookmark-bar id "1". If unavailable, use the first
  // user-visible bookmark folder as a fallback.
  const root = tree?.[0];
  const bookmarkBar = root?.children?.find(n => !n.url && n.id === '1') || root?.children?.find(n => !n.url && n.children);
  if (!bookmarkBar) throw new Error('No bookmark folder available');

  return createBookmark({ parentId: bookmarkBar.id, title: QUICK_SAVE_FOLDER });
}

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'quick-save') return;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    if (!tab?.url || /^(chrome|edge|about|chrome-extension):/i.test(tab.url)) return;

    const tree = await getTree();
    const folder = await getOrCreateQuickSaveFolder(tree);
    await createBookmark({
      parentId: folder.id,
      title: tab.title || tab.url,
      url: tab.url
    });
  } catch (error) {
    console.error('LumiBoard quick save failed:', error);
  }
});
