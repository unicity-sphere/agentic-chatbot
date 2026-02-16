"""Markdown-aware text chunking for RAG ingestion.

Strategy: parse the document into a tree of sections by header level,
then emit each leaf section (deepest subsection) as a single chunk with
its parent header chain prepended for context.  Sections are only split
by paragraphs as a last resort when they exceed a hard ceiling.
"""

import re
from dataclasses import dataclass, field


@dataclass
class Chunk:
    text: str
    metadata: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_image_refs(text: str) -> str:
    """Scan chunk text for image references, return comma-separated filenames."""
    refs: list[str] = []
    for m in re.finditer(r'<(?:img|embed)\s[^>]*src="pic/([^"]+)"', text):
        fname = m.group(1)
        if fname not in refs:
            refs.append(fname)
    return ",".join(refs)


def _clean_images_for_embedding(text: str) -> str:
    """Strip image/embed/figure HTML tags so they don't pollute embeddings."""
    text = re.sub(r"<(?:img|embed)\s[^>]*/?>", "[Figure]", text)
    text = re.sub(r"<figure[^>]*>.*?</figure>", "[Figure]", text, flags=re.DOTALL)
    return text


# ---------------------------------------------------------------------------
# Section tree
# ---------------------------------------------------------------------------

@dataclass
class _Section:
    """A markdown section: its header line, body text, and child subsections."""
    level: int            # 0 = root (no header), 1 = #, 2 = ##, ...
    header: str           # full header line including "#" prefix, or ""
    title: str            # extracted title text (without # and {attrs})
    body: str             # text between this header and the next header
    children: list["_Section"] = field(default_factory=list)


def _parse_sections(text: str) -> _Section:
    """Parse markdown into a tree of nested sections by header level."""
    # Split into (header_line_or_None, body_text) pairs
    parts: list[tuple[str, int, str]] = []  # (header, level, body)
    header_re = re.compile(r"^(#{1,6})\s+(.*?)(?:\s*\{.*?\})?\s*$")

    lines = text.split("\n")
    current_header = ""
    current_level = 0
    current_title = ""
    body_lines: list[str] = []

    def flush():
        body = "\n".join(body_lines).strip()
        parts.append((current_header, current_level, body))

    for line in lines:
        m = header_re.match(line)
        if m:
            flush()
            current_header = line.strip()
            current_level = len(m.group(1))
            current_title = m.group(2).strip()
            body_lines = []
        else:
            body_lines.append(line)

    flush()

    # Build tree: root node at level 0
    root = _Section(level=0, header="", title="", body="")
    stack: list[_Section] = [root]

    for header, level, body in parts:
        if level == 0:
            # Preamble text before any header
            root.body = body
            continue

        title_match = re.match(r"^#{1,6}\s+(.*?)(?:\s*\{.*?\})?\s*$", header)
        title = title_match.group(1).strip() if title_match else ""

        node = _Section(level=level, header=header, title=title, body=body)

        # Pop stack until we find the parent (a section with strictly lower level)
        while len(stack) > 1 and stack[-1].level >= level:
            stack.pop()

        stack[-1].children.append(node)
        stack.append(node)

    return root


# ---------------------------------------------------------------------------
# Tree → chunks
# ---------------------------------------------------------------------------

_HARD_CEILING = 6000  # only split within a section if it exceeds this


def _header_chain(ancestors: list[_Section]) -> str:
    """Build the parent header chain (excluding root)."""
    return "\n\n".join(s.header for s in ancestors if s.header)


def _section_full_text(section: _Section) -> str:
    """Recursively collect all text under a section (header + body + children)."""
    parts: list[str] = []
    if section.header:
        parts.append(section.header)
    if section.body:
        parts.append(section.body)
    for child in section.children:
        parts.append(_section_full_text(child))
    return "\n\n".join(parts)


def _emit_chunk(text: str, source: str, title: str, chunks: list[Chunk]) -> None:
    """Create a Chunk from text, extracting images and cleaning for embedding."""
    text = text.strip()
    if not text:
        return
    images = _extract_image_refs(text)
    meta: dict = {"source": source, "section": title}
    if images:
        meta["images"] = images
    embedding_text = _clean_images_for_embedding(text)
    chunks.append(Chunk(text=embedding_text, metadata=meta))


def _split_oversized(text: str, source: str, title: str, chunks: list[Chunk]) -> None:
    """Last-resort split for a section that exceeds _HARD_CEILING.

    Splits by paragraphs, accumulating until the ceiling.  Each sub-chunk
    starts at a paragraph boundary (never mid-word).
    """
    paragraphs = re.split(r"\n\n+", text)
    current = ""
    for para in paragraphs:
        if current and len(current) + 2 + len(para) > _HARD_CEILING:
            _emit_chunk(current, source, title, chunks)
            current = para
        else:
            current = current + "\n\n" + para if current else para
    _emit_chunk(current, source, title, chunks)


def _walk(
    section: _Section,
    ancestors: list[_Section],
    source: str,
    chunks: list[Chunk],
    soft_limit: int,
) -> None:
    """Recursively walk the section tree and emit chunks.

    Strategy:
    1. If this section (including all descendants) fits in soft_limit →
       emit as one chunk (prepend ancestor headers for context).
    2. If it has children → emit the section's own body (with context),
       then recurse into each child.
    3. If it's a leaf but exceeds _HARD_CEILING → paragraph-split.
    4. Otherwise → emit as-is (even if above soft_limit — keeping whole
       sections is more important than uniform size).
    """
    full_text = _section_full_text(section)
    context_prefix = _header_chain(ancestors)
    title = section.title or (ancestors[-1].title if ancestors else "")

    # Case 1: entire subtree fits comfortably → single chunk
    if len(full_text) <= soft_limit:
        chunk_text = context_prefix + "\n\n" + full_text if context_prefix else full_text
        _emit_chunk(chunk_text, source, title, chunks)
        return

    # Case 2: has children → emit own body, recurse children
    if section.children:
        # Emit this section's own body (text before first child) with context
        own_parts: list[str] = []
        if context_prefix:
            own_parts.append(context_prefix)
        if section.header:
            own_parts.append(section.header)
        if section.body:
            own_parts.append(section.body)
        own_text = "\n\n".join(own_parts)
        if own_text.strip():
            _emit_chunk(own_text, source, title, chunks)

        new_ancestors = ancestors + [section]
        for child in section.children:
            _walk(child, new_ancestors, source, chunks, soft_limit)
        return

    # Case 3/4: leaf section, no children
    chunk_parts: list[str] = []
    if context_prefix:
        chunk_parts.append(context_prefix)
    if section.header:
        chunk_parts.append(section.header)
    if section.body:
        chunk_parts.append(section.body)
    chunk_text = "\n\n".join(chunk_parts)

    if len(chunk_text) > _HARD_CEILING:
        # Prepend context header to each sub-chunk's title area
        header_block = context_prefix + "\n\n" + section.header if context_prefix and section.header else (context_prefix or section.header or "")
        body_to_split = header_block + "\n\n" + section.body if header_block else section.body
        _split_oversized(body_to_split, source, title, chunks)
    else:
        _emit_chunk(chunk_text, source, title, chunks)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def chunk_markdown(
    text: str,
    source: str,
    max_chunk_size: int = 1500,
    overlap: int = 200,           # kept for API compat, no longer used
) -> list[Chunk]:
    """Split markdown into section-aware chunks.

    Each chunk contains a complete section (or subsection) with its parent
    header chain prepended for context.  Sections are only paragraph-split
    when they exceed a hard ceiling (6000 chars).

    The *max_chunk_size* parameter acts as a soft limit: sections smaller
    than this (including all descendants) are emitted as a single chunk.
    Larger sections are recursed into subsections.  The *overlap* parameter
    is accepted for backward compatibility but is no longer used — overlap
    is achieved naturally by repeating parent headers in each chunk.
    """
    # Remove YAML frontmatter
    text = re.sub(r"^---\n.*?\n---\n", "", text, flags=re.DOTALL)

    root = _parse_sections(text)
    chunks: list[Chunk] = []

    # Handle preamble (text before first header)
    if root.body:
        _emit_chunk(root.body, source, "", chunks)

    for child in root.children:
        _walk(child, [], source, chunks, soft_limit=max_chunk_size)

    return chunks
