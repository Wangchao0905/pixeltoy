#!/usr/bin/env python3
"""Build a clean, structured screenplay DOCX from PixelTale handoff artifacts."""

import json
import re
import sys
import zipfile
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PR_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
DC_NS = "http://purl.org/dc/elements/1.1/"
DCT_NS = "http://purl.org/dc/terms/"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
W = f"{{{W_NS}}}"
R = f"{{{R_NS}}}"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

ET.register_namespace("w", W_NS)
ET.register_namespace("r", R_NS)
ET.register_namespace("dc", DC_NS)
ET.register_namespace("dcterms", DCT_NS)
ET.register_namespace("xsi", XSI_NS)

FONT = "Hiragino Sans GB"
LATIN_FONT = "Arial"
INK = "17202A"
MUTED = "66737D"
BLUE = "1F5F85"
LIGHT_BLUE = "E8F0F5"
LIGHT_GRAY = "F4F6F8"


def node(tag, attrs=None, children=None, text=None):
    element = ET.Element(tag, attrs or {})
    if text is not None:
        element.text = text
    for child in children or []:
        element.append(child)
    return element


def clean(value, fallback=""):
    if isinstance(value, (list, tuple)):
        value = "、".join(clean(item, "") for item in value if clean(item, ""))
    elif isinstance(value, dict):
        value = "；".join(f"{key}：{clean(item, '')}" for key, item in value.items() if clean(item, ""))
    value = str(value or "").replace("\r", " ").replace("\n", " ")
    value = re.sub(r"```(?:json|markdown)?", "", value, flags=re.IGNORECASE)
    value = re.sub(r"^[\s#>*•·-]+", "", value)
    value = re.sub(r"^\s*\d+[.)、]\s*", "", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value or fallback


def first(*values, fallback="未设定"):
    for value in values:
        result = clean(value, "")
        if result:
            return result
    return fallback


def rpr(size=21, color=INK, bold=False, italic=False, font=FONT):
    props = node(W + "rPr")
    props.append(node(W + "rFonts", {W + "ascii": LATIN_FONT, W + "hAnsi": LATIN_FONT, W + "eastAsia": font}))
    props.append(node(W + "sz", {W + "val": str(size * 2)}))
    props.append(node(W + "szCs", {W + "val": str(size * 2)}))
    if color:
        props.append(node(W + "color", {W + "val": color}))
    if bold:
        props.append(node(W + "b"))
    if italic:
        props.append(node(W + "i"))
    return props


def run(text, size=21, color=INK, bold=False, italic=False, font=FONT):
    value = node(W + "r")
    value.append(rpr(size=size, color=color, bold=bold, italic=italic, font=font))
    value.append(node(W + "t", text=text, attrs={XML_SPACE: "preserve"}))
    return value


def paragraph(text="", style="Normal", align=None, before=None, after=None, left=None, right=None, keep_next=False, page_break=False, shading=None):
    p = node(W + "p")
    ppr = node(W + "pPr")
    if style:
        ppr.append(node(W + "pStyle", {W + "val": style}))
    if align:
        ppr.append(node(W + "jc", {W + "val": align}))
    if before is not None or after is not None:
        ppr.append(node(W + "spacing", {W + "before": str(before or 0), W + "after": str(after or 0), W + "line": "280", W + "lineRule": "auto"}))
    if left is not None or right is not None:
        ppr.append(node(W + "ind", {**({W + "left": str(left)} if left is not None else {}), **({W + "right": str(right)} if right is not None else {})}))
    if keep_next:
        ppr.append(node(W + "keepNext"))
    if page_break:
        ppr.append(node(W + "pageBreakBefore"))
    if shading:
        ppr.append(node(W + "shd", {W + "val": "clear", W + "fill": shading}))
    p.append(ppr)
    if text:
        p.append(run(text))
    return p


def labeled_paragraph(label, value, style="Normal"):
    p = paragraph(style=style)
    p.find(W + "pPr").append(node(W + "spacing", {W + "before": "0", W + "after": "100", W + "line": "280", W + "lineRule": "auto"}))
    p.append(run(f"{label}：", bold=True))
    p.append(run(clean(value, "未设定")))
    return p


def style(style_id, name, size=21, color=INK, bold=False, italic=False, before=0, after=120, align=None, left=None, right=None, keep_next=False, based_on="Normal", shading=None):
    item = node(W + "style", {W + "type": "paragraph", W + "styleId": style_id})
    item.append(node(W + "name", {W + "val": name}))
    if based_on and based_on != style_id:
        item.append(node(W + "basedOn", {W + "val": based_on}))
    ppr = node(W + "pPr")
    ppr.append(node(W + "spacing", {W + "before": str(before), W + "after": str(after), W + "line": "280", W + "lineRule": "auto"}))
    if align:
        ppr.append(node(W + "jc", {W + "val": align}))
    if left is not None or right is not None:
        ppr.append(node(W + "ind", {**({W + "left": str(left)} if left is not None else {}), **({W + "right": str(right)} if right is not None else {})}))
    if keep_next:
        ppr.append(node(W + "keepNext"))
    if shading:
        ppr.append(node(W + "shd", {W + "val": "clear", W + "fill": shading}))
    item.append(ppr)
    item.append(rpr(size=size, color=color, bold=bold, italic=italic))
    return item


def styles_xml():
    root = node(W + "styles")
    doc_defaults = node(W + "docDefaults")
    run_default = node(W + "rPrDefault")
    run_default.append(rpr())
    doc_defaults.append(run_default)
    p_default = node(W + "pPrDefault")
    p_default.append(node(W + "pPr", children=[node(W + "spacing", {W + "after": "120", W + "line": "280", W + "lineRule": "auto"})]))
    doc_defaults.append(p_default)
    root.append(doc_defaults)
    root.append(style("Normal", "Normal", size=10, after=120))
    root.append(style("Kicker", "Kicker", size=9, color=BLUE, bold=True, after=180, align="center"))
    root.append(style("Title", "Title", size=26, color=INK, bold=True, after=120, align="center", keep_next=True))
    root.append(style("Subtitle", "Subtitle", size=13, color=MUTED, after=360, align="center", keep_next=True))
    root.append(style("Heading1", "Heading 1", size=16, color=BLUE, bold=True, before=360, after=160, keep_next=True))
    root.append(style("Heading2", "Heading 2", size=13, color=BLUE, bold=True, before=240, after=100, keep_next=True))
    root.append(style("Meta", "Meta", size=9, color=MUTED, after=80))
    root.append(style("SceneHeading", "Scene Heading", size=11, color=INK, bold=True, before=240, after=80, keep_next=True, shading=LIGHT_BLUE))
    root.append(style("Action", "Action", size=10, color=INK, after=100))
    root.append(style("Character", "Character", size=10, color=INK, bold=True, before=170, after=20, align="center", keep_next=True))
    root.append(style("Parenthetical", "Parenthetical", size=9, color=MUTED, italic=True, after=30, align="center", left=1080, right=1080, keep_next=True))
    root.append(style("Dialogue", "Dialogue", size=10, color=INK, after=90, left=720, right=720))
    root.append(style("DialogueNote", "Dialogue Note", size=9, color=MUTED, italic=True, after=100, left=720, right=720))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def header_xml():
    root = node(W + "hdr")
    root.append(paragraph("PIXELTALE  /  正式剧本", style="Meta", align="right", after=0))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def footer_xml():
    root = node(W + "ftr")
    p = paragraph(style="Meta", align="right", after=0)
    p.append(run("第 ", size=9, color=MUTED))
    field = node(W + "fldSimple", {W + "instr": "PAGE"})
    field.append(run("1", size=9, color=MUTED))
    p.append(field)
    p.append(run(" 页", size=9, color=MUTED))
    root.append(p)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def document_xml(payload):
    root = node(W + "document")
    body = node(W + "body")
    source = payload.get("sourceArtifacts") or {}
    brief = source.get("brief") or {}
    proposal = source.get("proposal") or {}
    characters = source.get("characters") or {}
    arc = source.get("arc") or {}
    scenes = source.get("scenes") or {}
    dialogue = source.get("dialogue") or {}

    title = first(proposal.get("title_zh"), brief.get("title_zh"), payload.get("title"), fallback="PixelTale 正式剧本")
    mode = first(payload.get("mode"), fallback="TK 短剧")
    episode_scale = first(payload.get("episode_scale"), fallback="未设定")
    duration = first(payload.get("duration"), fallback="未设定")
    dialogue_mode = first(payload.get("dialogue_mode"), fallback="英文口语化本土化")

    body.append(paragraph("PIXELTALE STORY FORGE", style="Kicker", align="center", after=180))
    body.append(paragraph(title, style="Title"))
    body.append(paragraph("正式剧本", style="Subtitle"))
    body.append(labeled_paragraph("剧作模式", mode, style="Meta"))
    body.append(labeled_paragraph("计划规模", episode_scale, style="Meta"))
    body.append(labeled_paragraph("单集时长", duration, style="Meta"))
    body.append(labeled_paragraph("对白策略", dialogue_mode, style="Meta"))
    body.append(paragraph("本文件由 PixelTale 编剧 Agent 根据已确认的故事结构生成。中文用于剧情、设定、动作与场景说明；英文用于人物对白，并遵循人物声线与本土化设定。", style="Meta", before=240, after=0))
    body.append(paragraph(page_break=True))

    body.append(paragraph("故事概览", style="Heading1"))
    body.append(labeled_paragraph("核心命题", proposal.get("premise_zh") or brief.get("core_conflict_zh")))
    body.append(labeled_paragraph("一句话梗概", proposal.get("logline_zh") or brief.get("logline_zh")))
    body.append(labeled_paragraph("观众追问", proposal.get("viewer_question_zh") or brief.get("viewer_question_zh")))
    body.append(labeled_paragraph("主角目标", proposal.get("protagonist_goal_zh")))
    body.append(labeled_paragraph("对抗力量", proposal.get("antagonistic_force_zh")))
    body.append(labeled_paragraph("持续推进引擎", proposal.get("season_or_series_engine_zh")))
    body.append(labeled_paragraph("开场承诺", proposal.get("first_impact_zh")))
    body.append(labeled_paragraph("首个反转", proposal.get("reversal_zh")))

    character_items = characters.get("characters") or []
    if character_items:
        body.append(paragraph("人物设定", style="Heading1"))
        for item in character_items:
            name = first(item.get("name_zh"), item.get("name_en"), fallback="未命名人物")
            body.append(paragraph(name, style="Heading2"))
            body.append(labeled_paragraph("英文名", item.get("name_en")))
            body.append(labeled_paragraph("人物身份", item.get("role")))
            body.append(labeled_paragraph("人物欲望", item.get("desire_zh")))
            body.append(labeled_paragraph("人物恐惧", item.get("fear_zh")))
            body.append(labeled_paragraph("隐藏秘密", item.get("secret_zh")))
            body.append(labeled_paragraph("人物弧线", item.get("arc_zh")))
            voice = (item.get("voice_rules_en") or [])
            if voice:
                body.append(labeled_paragraph("英文声线", "；".join(clean(value) for value in voice)))

    units = arc.get("units") or []
    if units:
        body.append(paragraph("分集与章节结构", style="Heading1"))
        for unit in units:
            number = clean(unit.get("number"), "")
            prefix = "第" + number + ("章" if mode == "普通长剧" else "集") if number else "章节"
            body.append(paragraph(f"{prefix}  {first(unit.get('title_zh'), fallback='未命名')}", style="Heading2"))
            body.append(labeled_paragraph("本集承诺", unit.get("promise_zh")))
            body.append(labeled_paragraph("开头暴击", unit.get("impact_zh")))
            body.append(labeled_paragraph("因果转折", unit.get("causal_turn_zh")))
            body.append(labeled_paragraph("反转", unit.get("reversal_zh")))
            body.append(labeled_paragraph("集尾强钩子", unit.get("hook_zh")))
            body.append(labeled_paragraph("未回答问题", unit.get("cliffhanger_question_zh")))
            body.append(labeled_paragraph("推进与回收", unit.get("payoff_zh")))

    scene_items = scenes.get("scenes") or []
    dialogue_items = dialogue.get("lines") or []
    characters_by_id = {clean(item.get("id"), ""): item for item in character_items}
    dialogue_by_scene = {}
    for line in dialogue_items:
        dialogue_by_scene.setdefault(clean(line.get("scene_id"), ""), []).append(line)

    if scene_items:
        body.append(paragraph("正式分场剧本", style="Heading1", page_break=True))
        for scene in scene_items:
            scene_id = first(scene.get("id"), fallback="场景")
            unit_number = clean(scene.get("unit_number"), "")
            location = first(scene.get("location_zh"), fallback="未设定场景")
            indoor = clean(scene.get("indoor_outdoor"), "")
            heading_bits = [f"第{unit_number}集" if unit_number else "场景", scene_id]
            if indoor:
                heading_bits.append(indoor)
            heading_bits.append(location)
            body.append(paragraph("  ".join(heading_bits), style="SceneHeading", shading=LIGHT_BLUE))
            body.append(labeled_paragraph("场景目的", scene.get("purpose_zh"), style="Action"))
            body.append(labeled_paragraph("出场人物", scene.get("characters"), style="Action"))
            body.append(labeled_paragraph("动作推进", scene.get("action_zh"), style="Action"))
            body.append(labeled_paragraph("视觉意图", scene.get("visual_intent_zh"), style="Action"))
            for line in dialogue_by_scene.get(scene_id, []):
                speaker = clean(line.get("speaker"), "人物")
                character = characters_by_id.get(speaker) or {}
                speaker_name = first(character.get("name_en"), character.get("name_zh"), speaker, fallback="人物")
                body.append(paragraph(speaker_name.upper(), style="Character"))
                delivery = clean(line.get("delivery_en"), "")
                if delivery:
                    body.append(paragraph(f"Delivery: {delivery}", style="Parenthetical"))
                dialogue_text = clean(line.get("dialogue_en"), "")
                if dialogue_text:
                    body.append(paragraph(dialogue_text, style="Dialogue"))
                subtext = clean(line.get("intent_zh") or line.get("subtext_zh"), "")
                if subtext:
                    body.append(paragraph(f"剧情意图：{subtext}", style="DialogueNote"))

    checks = dialogue.get("localization_checks") or []
    if checks:
        body.append(paragraph("对白本土化检查", style="Heading1"))
        for check in checks:
            body.append(labeled_paragraph("检查项", check, style="Meta"))

    sect = node(W + "sectPr")
    sect.append(node(W + "headerReference", {W + "type": "default", R + "id": "rId1"}))
    sect.append(node(W + "footerReference", {W + "type": "default", R + "id": "rId2"}))
    sect.append(node(W + "pgSz", {W + "w": "12240", W + "h": "15840"}))
    sect.append(node(W + "pgMar", {W + "top": "1440", W + "right": "1440", W + "bottom": "1440", W + "left": "1440", W + "header": "708", W + "footer": "708", W + "gutter": "0"}))
    body.append(sect)
    root.append(body)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def rels_xml():
    ET.register_namespace("", PR_NS)
    root = node(f"{{{PR_NS}}}Relationships")
    root.append(node(f"{{{PR_NS}}}Relationship", {"Id": "rId1", "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "Target": "word/document.xml"}))
    root.append(node(f"{{{PR_NS}}}Relationship", {"Id": "rId2", "Type": "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "Target": "docProps/core.xml"}))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def document_rels_xml():
    ET.register_namespace("", PR_NS)
    root = node(f"{{{PR_NS}}}Relationships")
    root.append(node(f"{{{PR_NS}}}Relationship", {"Id": "rId1", "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header", "Target": "header1.xml"}))
    root.append(node(f"{{{PR_NS}}}Relationship", {"Id": "rId2", "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer", "Target": "footer1.xml"}))
    root.append(node(f"{{{PR_NS}}}Relationship", {"Id": "rId3", "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", "Target": "styles.xml"}))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def content_types_xml():
    ET.register_namespace("", CT_NS)
    root = node(f"{{{CT_NS}}}Types")
    root.append(node(f"{{{CT_NS}}}Default", {"Extension": "rels", "ContentType": "application/vnd.openxmlformats-package.relationships+xml"}))
    root.append(node(f"{{{CT_NS}}}Default", {"Extension": "xml", "ContentType": "application/xml"}))
    root.append(node(f"{{{CT_NS}}}Override", {"PartName": "/word/document.xml", "ContentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"}))
    root.append(node(f"{{{CT_NS}}}Override", {"PartName": "/word/styles.xml", "ContentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"}))
    root.append(node(f"{{{CT_NS}}}Override", {"PartName": "/word/header1.xml", "ContentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"}))
    root.append(node(f"{{{CT_NS}}}Override", {"PartName": "/word/footer1.xml", "ContentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"}))
    root.append(node(f"{{{CT_NS}}}Override", {"PartName": "/docProps/core.xml", "ContentType": "application/vnd.openxmlformats-package.core-properties+xml"}))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def core_xml(payload):
    root = node(f"{{http://schemas.openxmlformats.org/package/2006/metadata/core-properties}}coreProperties")
    title = first(payload.get("title"), fallback="PixelTale 正式剧本")
    root.append(node(f"{{{DC_NS}}}title", text=title))
    root.append(node(f"{{{DC_NS}}}creator", text="PixelTale Story Forge"))
    root.append(node(f"{{{DCT_NS}}}created", text=datetime.now(timezone.utc).isoformat()))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def write_docx(output, payload):
    parts = {
        "[Content_Types].xml": content_types_xml(),
        "_rels/.rels": rels_xml(),
        "word/document.xml": document_xml(payload),
        "word/styles.xml": styles_xml(),
        "word/header1.xml": header_xml(),
        "word/footer1.xml": footer_xml(),
        "word/_rels/document.xml.rels": document_rels_xml(),
        "docProps/core.xml": core_xml(payload),
    }
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as target:
        for name, data in parts.items():
            target.writestr(name, data)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: pixeltale-script-document.py OUTPUT.docx")
    payload = json.load(sys.stdin)
    write_docx(sys.argv[1], payload)


if __name__ == "__main__":
    main()
