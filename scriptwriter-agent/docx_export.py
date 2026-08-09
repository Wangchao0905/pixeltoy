"""纯 Python 零依赖 docx 生成（zip + 最小 OOXML）。

v4.1 交付格式：参考短剧标准剧本（对标/核心看点/人物简介/剧本正文），
动作行 △ 前缀、对白"角色：台词"、场景"集-场 地点"、场景人物清单。
"""
import zipfile
import xml.sax.saxutils as sax


def _par(text, bold=False):
    rpr = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return f"<w:p><w:r>{rpr}<w:t>{sax.escape(str(text))}</w:t></w:r></w:p>"


def _heading(text):
    return f'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>{sax.escape(str(text))}</w:t></w:r></w:p>'


def _scene_block(ep_idx, scene_idx, scene):
    """一个场景块：'集-场 地点' + 人物清单 + △动作行 + '角色：对白'。"""
    loc = scene.get("location") or "未命名场景"
    speakers = []
    for b in scene.get("beats", []) or []:
        s = (b.get("speaker") or "").strip()
        if s and s not in speakers:
            speakers.append(s)
    lines = [f"{ep_idx}-{scene_idx + 1} {loc}"]
    if speakers:
        lines.append(f"人物：{' '.join(speakers)}")
    for b in scene.get("beats", []) or []:
        action = (b.get("action") or "").strip()
        line = (b.get("line") or "").strip()
        speaker = (b.get("speaker") or "").strip()
        if action:
            lines.append(f"△{action}")
        if line:
            lines.append(f"{speaker}：{line}" if speaker else line)
    return [_par(l) for l in lines]


def _characters_section(worldbuilding):
    """人物简介：每人一行名字 + 一段人设（persona/motivation 合并）。"""
    chars = (worldbuilding or {}).get("characters", []) or []
    out = []
    for c in chars:
        name = c.get("name") or ""
        persona = c.get("persona") or ""
        motivation = c.get("motivation") or ""
        body = "；".join(x for x in (persona, motivation) if x)
        out.append(_par(name, bold=True))
        if body:
            out.append(_par(body))
    return out


def export_docx(state, path):
    idea = state.idea if isinstance(state.idea, dict) else {}
    wb = state.artifacts.get("worldbuilding", {}) or {}
    goal = idea.get("goal") or "未命名"
    # 标题 + 项目信息（有数据才输出，不编造）
    parts = [_par(f"《{goal}》", bold=True)]
    if idea.get("raw"):
        parts.append(_par("剧情简介："))
        parts.append(_par(idea["raw"]))
    # 人物简介
    parts.append(_heading("人物简介"))
    chars = _characters_section(wb)
    parts.extend(chars if chars else [_par("（暂无人物设定）")])
    # 剧本正文（分集，按参考格式）
    parts.append(_heading("剧本正文："))
    episodes = state.artifacts.get("episodes", {}) or {}
    for idx in sorted(episodes, key=lambda k: (len(k), k)):
        ep = episodes[idx]
        parts.append(_par(f"第{idx}集", bold=True))
        if not isinstance(ep, dict):
            parts.append(_par("（本集生成失败，待人工处理）"))
            continue
        scenes = ep.get("scenes", []) or []
        for si, scene in enumerate(scenes):
            parts.extend(_scene_block(int(idx), si, scene))
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
