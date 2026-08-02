#!/usr/bin/env python3
"""Create a visual-asset DOCX from the retained PixelTale Word template."""

import copy
import json
import sys
import zipfile
from xml.etree import ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{W_NS}}}"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
ET.register_namespace("w", W_NS)


def clean(value, fallback="未设定"):
    if isinstance(value, (list, tuple)):
        value = "、".join(clean(item, "") for item in value if clean(item, ""))
    if isinstance(value, dict):
        value = "；".join(f"{key}：{clean(item, '')}" for key, item in value.items() if clean(item, ""))
    value = " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split())
    return value or fallback


def paragraph(text, style=None, bullet=False):
    node = ET.Element(W + "p")
    ppr = ET.SubElement(node, W + "pPr")
    if style:
        pstyle = ET.SubElement(ppr, W + "pStyle")
        pstyle.set(W + "val", style)
    if bullet:
        num_pr = ET.SubElement(ppr, W + "numPr")
        ilvl = ET.SubElement(num_pr, W + "ilvl")
        ilvl.set(W + "val", "0")
        num_id = ET.SubElement(num_pr, W + "numId")
        num_id.set(W + "val", "1")
    run = ET.SubElement(node, W + "r")
    text_node = ET.SubElement(run, W + "t")
    text_node.set(XML_SPACE, "preserve")
    text_node.text = clean(text, "")
    return node


def asset_heading(asset):
    identifier = clean(asset.get("id"), "ASSET")
    name_zh = clean(asset.get("name_zh"), "未命名资产")
    name_en = clean(asset.get("name_en"), "")
    return f"{identifier} {name_zh}{f' {name_en}' if name_en else ''}"


def add_asset(body, asset, fields):
    body.append(paragraph(asset_heading(asset), "Heading2"))
    for label, key in fields:
        body.append(paragraph(f"{label}：{clean(asset.get(key))}", bullet=True))


def build_document(template_bytes, payload):
    root = ET.fromstring(template_bytes)
    body = root.find(W + "body")
    if body is None:
        raise ValueError("模板缺少 w:body")
    sect_pr = body.find(W + "sectPr")
    for child in list(body):
        body.remove(child)

    title = clean(payload.get("title"), "PixelTale")
    mode = clean(payload.get("mode"), "TK 短剧")
    episode_scale = clean(payload.get("episode_scale"), "未设定")
    duration = clean(payload.get("duration"), "未设定")
    body.append(paragraph(f"{title} — 视觉资产设计（文生图用）", "Heading1"))
    body.append(paragraph(
        f"本档独立于剧本，供大模型解析与文生图取用。分类硬分区（人物 / 场景 / 道具），字段名与顺序全剧统一，唯一编号。模式：{mode}；计划：{episode_scale}；单集时长：{duration}。每条「文生图提示词」为可直接出图的中文画面描述，不含剧情台词。仅收在全剧中重复出现的主要资产。"
    ))

    sections = [
        ("人物", payload.get("characters") or [], [
            ("类型", "type"), ("别名", "aliases"), ("性别", "gender"), ("年龄相", "age_phase"),
            ("体型", "body"), ("发型发色", "hair_color"), ("面部特征", "facial_features"),
            ("瞳色", "eye_color"), ("服装配饰", "costume_accessories"), ("识别色", "palette"),
            ("气质姿态", "posture"), ("文生图提示词", "prompt_zh"),
        ]),
        ("场景", payload.get("scenes") or [], [
            ("类型", "type"), ("别名", "aliases"), ("室内外", "indoor_outdoor"), ("光线", "lighting"),
            ("色调", "palette"), ("建筑材质", "materials"), ("空间布局", "layout"),
            ("氛围气味", "atmosphere"), ("文生图提示词", "prompt_zh"),
        ]),
        ("道具", payload.get("props") or [], [
            ("类型", "type"), ("别名", "aliases"), ("材质", "materials"), ("颜色形态", "appearance"),
            ("尺寸", "size"), ("特殊质感", "texture"), ("文生图提示词", "prompt_zh"),
        ]),
    ]
    for section_name, assets, fields in sections:
        if not assets:
            continue
        body.append(paragraph(section_name, "Heading1"))
        for asset in assets:
            add_asset(body, asset, fields)

    if payload.get("consistency_notes"):
        body.append(paragraph("全剧视觉一致性", "Heading1"))
        for note in payload["consistency_notes"]:
            body.append(paragraph(clean(note), bullet=True))

    if sect_pr is not None:
        body.append(copy.deepcopy(sect_pr))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: pixeltale-production.py TEMPLATE.docx OUTPUT.docx")
    template, output = sys.argv[1:]
    payload = json.load(sys.stdin)
    with zipfile.ZipFile(template, "r") as source:
        parts = {name: source.read(name) for name in source.namelist()}
    parts["word/document.xml"] = build_document(parts["word/document.xml"], payload)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as target:
        for name, data in parts.items():
            target.writestr(name, data)


if __name__ == "__main__":
    main()
