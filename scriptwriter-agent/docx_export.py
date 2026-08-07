"""纯 Python 零依赖 docx 生成（zip + 最小 OOXML）。"""
import zipfile
import xml.sax.saxutils as sax

def _par(text):  # paragraph
    return f"<w:p><w:r><w:t>{sax.escape(str(text))}</w:t></w:r></w:p>"

def _heading(text):
    return f'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>{sax.escape(str(text))}</w:t></w:r></w:p>'

def export_docx(state, path):
    parts = [_heading(f"《{state.idea.get('goal', '未命名')}》剧本")]
    parts.append(_heading("一、分集大纲"))
    for ep in state.artifacts.get("outline", {}).get("episodes", []):
        parts.append(_par(f"第{ep.get('index')}集 钩子：{ep.get('hook')} 悬念：{ep.get('cliffhanger')}"))
    parts.append(_heading("二、逐集剧本"))
    for idx, ep in state.artifacts.get("episodes", {}).items():
        parts.append(_heading(f"第{idx}集"))
        if ep is None:
            # 生成失败待人工处理的集：导出占位提示而非崩溃
            parts.append(_par("（本集生成失败，待人工处理）"))
            continue
        for scene in ep.get("scenes", []):
            parts.append(_par(f"【场景】{scene.get('location')}"))
            for beat in scene.get("beats", []):
                speaker = beat.get("speaker", "")
                line = beat.get("line", "")
                parts.append(_par(f"{speaker}：{line}" if line else beat.get("action", "")))
    parts.append(_heading("三、审核记录（附录）"))
    parts.append(_par(str(state.evaluation)))
    document_xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                    '<w:body>' + "".join(parts) + '</w:body></w:document>')
    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                     '<Default Extension="xml" ContentType="application/xml"/>'
                     '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                     '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", document_xml)
    return path
