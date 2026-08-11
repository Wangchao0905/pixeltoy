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

FONT = "黑体"
LATIN_FONT = "Arial"
INK = "000000"


def node(tag, attrs=None, children=None, text=None):
    element = ET.Element(tag, attrs or {})
    if text is not None:
        element.text = text
    for child in children or []:
        element.append(child)
    return element


import re as _re_codename

def strip_codename(name):
    # 2026-08-10：剧本中一律使用角色/场景名字，不出现 C001/S001 类代号
    if not isinstance(name, str):
        return name
    return _re_codename.sub(r"^C\d+\s*", "", name)

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


def expected_episode_count(payload):
    input_data = payload.get("input") or {}
    direct = input_data.get("episodeCount")
    try:
        direct_number = int(direct)
        if direct_number > 0:
            return direct_number
    except (TypeError, ValueError):
        pass
    match = re.search(r"\d+", clean(payload.get("episode_scale"), ""))
    return int(match.group(0)) if match else 0


def rpr(size=21, color=INK, bold=False, italic=False, font=FONT):
    props = node(W + "rPr")
    props.append(node(W + "rFonts", {W + "hint": "eastAsia", W + "ascii": LATIN_FONT, W + "hAnsi": LATIN_FONT, W + "eastAsia": font}))
    props.append(node(W + "lang", {W + "val": "en-US", W + "eastAsia": "zh-CN"}))
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


def reference_paragraph(text="", bold=False, align=None, before=0, after=0, page_break=False, size=10.5):
    """Build the plain paragraph shape used by the reference short-drama DOCX."""
    p = paragraph(style="Normal", align=align, before=before, after=after, page_break=page_break)
    if text:
        p.append(run(text, size=size, color=INK, bold=bold, font=FONT))
    return p


def reference_labeled_paragraph(label, value, before=0, after=0):
    p = paragraph(style="Normal", before=before, after=after)
    p.append(run(label, size=10.5, color=INK, bold=True, font=FONT))
    p.append(run(clean(value, ""), size=10.5, color=INK, font=FONT))
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
    root.append(style("Normal", "Normal", size=10.5, color=INK, after=0))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def chinese_number(value):
    number = int(value)
    digits = "零一二三四五六七八九"
    if number < 10:
        return digits[number]
    if number < 20:
        return "十" if number == 10 else f"十{digits[number - 10]}"
    if number < 100:
        tens, ones = divmod(number, 10)
        return f"{digits[tens]}十" if ones == 0 else f"{digits[tens]}十{digits[ones]}"
    return str(number)


def normalize_daypart(value):
    value = clean(value, "")
    if any(token in value for token in ("夜", "晚", "深夜")):
        return "夜"
    if any(token in value for token in ("日", "上午", "下午", "清晨", "白天", "早晨")):
        return "日"
    return value or "日"


def normalize_indoor(value, location=""):
    value = clean(value, "").lower()
    if value in {"外", "外景", "室外", "outdoor", "exterior", "ext"}:
        return "外"
    if value in {"内", "内景", "室内", "indoor", "interior", "int"}:
        return "内"
    location = clean(location, "")
    if any(token in location for token in ("前院", "院子", "庭院", "街", "公园", "停车场", "车道", "屋顶")):
        return "外"
    return "内"


def character_summary(item):
    role_map = {
        "protagonist": "主角",
        "antagonist": "反派",
        "key_supporting": "重要配角",
        "supporting": "配角",
    }
    parts = []
    role = clean(item.get("role"), "")
    if role_map.get(role):
        parts.append(role_map[role])
    for key in ("desire_zh", "fear_zh", "secret_zh", "arc_zh"):
        value = clean(item.get(key), "")
        if value and value not in {"无", "未设定"}:
            parts.append(value)
    return "。".join(parts).strip("。")


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
    screenplay = payload.get("screenplay") or {}
    input_data = payload.get("input") or {}

    title = first(proposal.get("title_zh"), brief.get("title_zh"), payload.get("title"), fallback="PixelTale 正式剧本")
    market = payload.get("market")
    market_label = market.get("label") if isinstance(market, dict) else market
    reference_title = first(input_data.get("referenceTitle"), input_data.get("reference_title_zh"), brief.get("reference_title_zh"), fallback="")
    hook = first(proposal.get("logline_zh"), proposal.get("premise_zh"), brief.get("logline_zh"), brief.get("core_conflict_zh"), fallback="")
    track = first(market_label, payload.get("mode"), fallback="")
    synopsis = first(proposal.get("premise_zh"), proposal.get("logline_zh"), brief.get("core_conflict_zh"), brief.get("logline_zh"), fallback="")

    body.append(reference_paragraph(title, bold=True, align="center", size=16, after=120))
    if reference_title:
        body.append(reference_labeled_paragraph("对标剧：", reference_title))
    if hook:
        body.append(reference_labeled_paragraph("核心看点：", hook))
    if track:
        body.append(reference_labeled_paragraph("短剧赛道：", track))
    if synopsis:
        body.append(reference_paragraph("剧情简介：", bold=True, before=120))
        body.append(reference_paragraph(synopsis))

    character_items = characters.get("characters") or []
    characters_by_id = {clean(item.get("id"), ""): item for item in character_items}
    if character_items:
        body.append(reference_paragraph("人物简介", bold=True, before=180))
        for item in character_items:
            name = first(item.get("name_zh"), item.get("name_en"), fallback="未命名人物")
            body.append(reference_paragraph(name, bold=True, before=120))
            summary = character_summary(item)
            if summary:
                body.append(reference_paragraph(summary))

    scene_items = scenes.get("scenes") or []
    dialogue_items = dialogue.get("lines") or []
    units = arc.get("units") or []
    expected_count = expected_episode_count(payload)
    covered_units = {int(scene.get("unit_number")) for scene in scene_items if str(scene.get("unit_number", "")).isdigit()}
    scene_ids = {clean(scene.get("id"), "") for scene in scene_items if clean(scene.get("id"), "")}
    dialogue_scene_ids = {clean(line.get("scene_id"), "") for line in dialogue_items if clean(line.get("scene_id"), "")}
    if not expected_count or len(units) != expected_count or len(scene_items) < expected_count or any(number not in covered_units for number in range(1, expected_count + 1)) or any(scene_id not in dialogue_scene_ids for scene_id in scene_ids):
        raise ValueError(f"正式剧本缺少逐集正文：期望 {expected_count or '计划'} 集，分集 {len(units)}，场景 {len(scene_items)}，对白 {len(dialogue_items)}")

    dialogue_by_scene = {}
    for line in dialogue_items:
        dialogue_by_scene.setdefault(clean(line.get("scene_id"), ""), []).append(line)
    scenes_by_unit = {}
    for scene in scene_items:
        scenes_by_unit.setdefault(int(scene.get("unit_number")), []).append(scene)

    body.append(reference_paragraph("剧本正文：", bold=True, before=180))
    formal_episodes = screenplay.get("episodes") or []
    if formal_episodes:
        for episode in formal_episodes:
            number = int(episode.get("number"))
            body.append(reference_paragraph(f"第{chinese_number(number)}集", bold=True, before=120))
            for scene in episode.get("scenes") or []:
                scene_number = first(scene.get("number"), fallback=f"{number}-1")
                time_label = normalize_daypart(scene.get("time_zh"))
                location = first(scene.get("location_zh"), fallback="地点未设定")
                indoor_label = normalize_indoor(scene.get("indoor_outdoor"), location)
                body.append(reference_paragraph(f"{scene_number} {location} {time_label} {indoor_label}", bold=True, before=120))
                roster_names = [clean(name, "") for name in scene.get("characters") or [] if clean(name, "")]
                if roster_names:
                    body.append(reference_labeled_paragraph("人物：", " ".join(roster_names)))
                action = clean(scene.get("action_zh"), "")
                if action:
                    body.append(reference_paragraph(action if action.startswith("△") else f"△{action}"))
                for line in scene.get("dialogue") or []:
                    speaker_name = first(line.get("speaker"), fallback="人物")
                    dialogue_text = clean(line.get("dialogue"), "")
                    if dialogue_text:
                        body.append(reference_paragraph(f"{speaker_name}：{dialogue_text}"))
    else:
      for unit in units:
        number = int(unit.get("number"))
        body.append(reference_paragraph(f"第{chinese_number(number)}集", bold=True, before=120))
        for scene_index, scene in enumerate(scenes_by_unit.get(number, []), start=1):
            scene_id = first(scene.get("id"), fallback="场景")
            time_label = normalize_daypart(scene.get("time_zh"))
            location = first(scene.get("location_zh"), fallback="地点未设定")
            indoor_label = normalize_indoor(scene.get("indoor_outdoor"), location)
            prefix = f"{number}-{scene_index} "
            heading_text = f"{prefix}{location} {time_label} {indoor_label}"
            body.append(reference_paragraph(heading_text, bold=True, before=120))

            roster = scene.get("characters") or []
            roster_names = []
            for cid in roster:
                cid_s = clean(cid, "")
                ch = characters_by_id.get(cid_s) or {}
                name = strip_codename(first(ch.get("name_zh"), ch.get("name_en"), cid_s, fallback="人物"))
                if name:
                    roster_names.append(name)
            if roster_names:
                body.append(reference_labeled_paragraph("人物：", " ".join(roster_names)))

            action = clean(scene.get("action_zh"), "")
            if action:
                body.append(reference_paragraph(action if action.startswith("△") else f"△{action}"))

            for line in dialogue_by_scene.get(scene_id, []):
                speaker = clean(line.get("speaker"), "人物")
                character = characters_by_id.get(speaker) or {}
                speaker_name = strip_codename(first(character.get("name_zh"), character.get("name_en"), speaker, fallback="人物"))
                if not speaker_name:
                    speaker_name = "人物"
                dialogue_text = clean(line.get("dialogue_en") or line.get("dialogue_zh") or line.get("dialogue"), "")
                if dialogue_text:
                    body.append(reference_paragraph(f"{speaker_name}：{dialogue_text}"))

    sect = node(W + "sectPr")
    sect.append(node(W + "pgSz", {W + "w": "11906", W + "h": "16838"}))
    sect.append(node(W + "pgMar", {W + "top": "1440", W + "right": "1800", W + "bottom": "1440", W + "left": "1800", W + "header": "851", W + "footer": "992", W + "gutter": "0"}))
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
    root.append(node(f"{{{PR_NS}}}Relationship", {"Id": "rId1", "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", "Target": "styles.xml"}))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def content_types_xml():
    ET.register_namespace("", CT_NS)
    root = node(f"{{{CT_NS}}}Types")
    root.append(node(f"{{{CT_NS}}}Default", {"Extension": "rels", "ContentType": "application/vnd.openxmlformats-package.relationships+xml"}))
    root.append(node(f"{{{CT_NS}}}Default", {"Extension": "xml", "ContentType": "application/xml"}))
    root.append(node(f"{{{CT_NS}}}Override", {"PartName": "/word/document.xml", "ContentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"}))
    root.append(node(f"{{{CT_NS}}}Override", {"PartName": "/word/styles.xml", "ContentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"}))
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
