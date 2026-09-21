"""
Import AE Shapes (AE2C4D)
-------------------------
Rebuilds After Effects shape layers in Cinema 4D from the JSON written by
ExportShapesToC4D.jsx, animation included.

- Every path becomes a bezier spline. Animated paths are keyed with Point
  Level Animation, one key per exported frame.
- A path with a Stroke becomes a Sweep with a circle profile. Stroke width
  (px) becomes the profile radius (cm) through the px -> cm scale, keyed if
  it animates. Round and projecting line caps become outside bevels.
- Trim Paths Start / End / Offset drive the Sweep's Start and End Growth.
  Offset wraps: a closed path whose trim window crosses its first vertex is
  swept along a doubled copy of the loop, and an open path gets a second
  "(wrap)" Sweep for the part that comes round to the start again.
- Rectangles, ellipses, stars and polygons are converted to beziers the way
  After Effects builds them (same start vertex and direction), so trims line
  up without "Convert to Bezier Path" first.
- Group transforms are baked into the points. The layer transform (parents,
  3D, auto-orient included) is either baked too, or animated on the layer's
  Null.

Run from: Extensions > User Scripts. Cinema 4D 2026, Python 3.11.
"""

import json
import math

import c4d

TITLE = "Import AE Shapes"
FORMAT = "chroma-ae-shapes"
EPS = 1e-6
C4D_TANGENT = 0.75  # C4D tangent length per unit of cubic bezier control offset, see Space.points

ORIGIN_CENTRE, ORIGIN_TOPLEFT = 0, 1
LAYER_BAKE, LAYER_NULL = 0, 1

# AE constants, as the scripting API reports them
AE_REVERSED = 3             # ADBE Vector Shape Direction
AE_STAR, AE_POLYGON = 1, 2  # ADBE Vector Star Type
AE_TRIM_INDIVIDUALLY = 2    # ADBE Vector Trim Type
AE_CAP_ROUND, AE_CAP_PROJECTING = 2, 3

ELLIPSE_KAPPA = 0.5519  # AE's own handle length for ellipses and rounded corners

UNSUPPORTED_OPERATORS = {
    "ADBE Vector Filter - Merge": "Merge Paths",
    "ADBE Vector Filter - Offset": "Offset Paths",
    "ADBE Vector Filter - PB": "Pucker & Bloat",
    "ADBE Vector Filter - Repeater": "Repeater",
    "ADBE Vector Filter - RC": "Round Corners",
    "ADBE Vector Filter - Twist": "Twist",
    "ADBE Vector Filter - Roughen": "Wiggle Paths",
    "ADBE Vector Filter - Zigzag": "Zig Zag",
    "ADBE Vector Filter - Wiggler": "Wiggle Transform",
}


# ---------------------------------------------------------------------------
# Animatable values: {"k": value} is static, {"f": [value per frame]} is not
# ---------------------------------------------------------------------------

def value_at(prop, fi, default=None):
    if prop is None:
        return default
    if "k" in prop:
        return prop["k"]
    return prop["f"][fi]


def is_animated(prop):
    return prop is not None and "f" in prop


# ---------------------------------------------------------------------------
# 2D affine maths, AE layer space (y down). Matrix = (a, b, c, d, tx, ty):
#   x' = a*x + c*y + tx
#   y' = b*x + d*y + ty
# ---------------------------------------------------------------------------

IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def mat_mul(m, n):
    """m * n: apply n first, then m."""
    a, b, c, d, tx, ty = m
    e, f, g, h, ux, uy = n
    return (a * e + c * f, b * e + d * f,
            a * g + c * h, b * g + d * h,
            a * ux + c * uy + tx, b * ux + d * uy + ty)


def mat_rot(deg):
    r = math.radians(deg)
    cs, sn = math.cos(r), math.sin(r)
    return (cs, sn, -sn, cs, 0.0, 0.0)


def mat_point(m, p):
    return (m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5])


def mat_vector(m, v):
    return (m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1])


def mat_area_scale(m):
    return math.sqrt(abs(m[0] * m[3] - m[1] * m[2]))


def group_matrix(tr, fi):
    """A shape group's Transform, in the order After Effects applies it:
    anchor, scale, skew about the skew axis, rotation, position."""
    if not tr:
        return IDENTITY
    ax, ay = value_at(tr.get("anchor"), fi, [0, 0])[:2]
    px, py = value_at(tr.get("position"), fi, [0, 0])[:2]
    sx, sy = value_at(tr.get("scale"), fi, [100, 100])[:2]
    skew = value_at(tr.get("skew"), fi, 0.0)
    skew_axis = value_at(tr.get("skewAxis"), fi, 0.0)
    rot = value_at(tr.get("rotation"), fi, 0.0)

    m = (1.0, 0.0, 0.0, 1.0, -ax, -ay)
    m = mat_mul((sx / 100.0, 0.0, 0.0, sy / 100.0, 0.0, 0.0), m)
    if skew:
        m = mat_mul(mat_rot(skew_axis), m)
        m = mat_mul((1.0, 0.0, math.tan(math.radians(-skew)), 1.0, 0.0, 0.0), m)
        m = mat_mul(mat_rot(-skew_axis), m)
    m = mat_mul(mat_rot(rot), m)
    return mat_mul((1.0, 0.0, 0.0, 1.0, px, py), m)


# ---------------------------------------------------------------------------
# Bezier paths. A path is {"v": [(x, y)], "i": [(x, y)], "o": [(x, y)],
# "c": closed}, tangents relative to their vertex, exactly as AE stores them.
# ---------------------------------------------------------------------------

def make_path(verts, ins, outs, closed):
    return {"v": [tuple(p) for p in verts], "i": [tuple(p) for p in ins],
            "o": [tuple(p) for p in outs], "c": bool(closed)}


def ae_shape_to_path(shape):
    return make_path(shape["v"], shape["i"], shape["o"], shape["c"])


def rect_path(size, pos, roundness, reversed_):
    """AE rectangle: starts on the right edge at the top, clockwise."""
    px, py = pos[:2]
    hw, hh = size[0] / 2.0, size[1] / 2.0
    r = max(0.0, min(hw, hh, roundness))
    right, left, top, bottom = px + hw, px - hw, py - hh, py + hh
    if r < EPS:
        verts = [(right, top), (right, bottom), (left, bottom), (left, top)]
        zero = [(0.0, 0.0)] * 4
        path = make_path(verts, zero, zero, True)
    else:
        h = r * ELLIPSE_KAPPA
        verts = [(right, top + r), (right, bottom - r), (right - r, bottom), (left + r, bottom),
                 (left, bottom - r), (left, top + r), (left + r, top), (right - r, top)]
        ins = [(0, -h), (0, 0), (h, 0), (0, 0), (0, h), (0, 0), (-h, 0), (0, 0)]
        outs = [(0, 0), (0, h), (0, 0), (-h, 0), (0, 0), (0, -h), (0, 0), (h, 0)]
        path = make_path(verts, ins, outs, True)
    return reverse_keep_start(path) if reversed_ else path


def ellipse_path(size, pos, reversed_):
    """AE ellipse: starts at the top, clockwise."""
    px, py = pos[:2]
    rx, ry = size[0] / 2.0, size[1] / 2.0
    kx, ky = rx * ELLIPSE_KAPPA, ry * ELLIPSE_KAPPA
    verts = [(px, py - ry), (px + rx, py), (px, py + ry), (px - rx, py)]
    ins = [(-kx, 0), (0, -ky), (kx, 0), (0, ky)]
    outs = [(kx, 0), (0, ky), (-kx, 0), (0, -ky)]
    path = make_path(verts, ins, outs, True)
    return reverse_keep_start(path) if reversed_ else path


def star_path(star_type, points, pos, rotation, inner_r, outer_r, inner_round, outer_round, reversed_):
    """AE star / polygon: first point straight up (before rotation), clockwise."""
    px, py = pos[:2]
    direction = -1 if reversed_ else 1
    if star_type == AE_POLYGON:
        count = max(3, int(math.floor(points)))
        radii = [(outer_r, outer_round / 100.0, 2 * math.pi * outer_r / (count * 4))] * count
    else:
        count = max(3, int(math.floor(points))) * 2
        long_seg = 2 * math.pi * outer_r / (count * 2)
        short_seg = 2 * math.pi * inner_r / (count * 2)
        radii = [(outer_r, outer_round / 100.0, long_seg) if k % 2 == 0 else
                 (inner_r, inner_round / 100.0, short_seg) for k in range(count)]
    step = 2 * math.pi / count
    angle = -math.pi / 2 + math.radians(rotation)
    verts, ins, outs = [], [], []
    for rad, roundness, seg in radii:
        x, y = rad * math.cos(angle), rad * math.sin(angle)
        length = math.hypot(x, y)
        tx, ty = (y / length, -x / length) if length > EPS else (0.0, 0.0)
        k = seg * roundness * direction
        verts.append((px + x, py + y))
        outs.append((-tx * k, -ty * k))
        ins.append((tx * k, ty * k))
        angle += step * direction
    return make_path(verts, ins, outs, True)


def reverse_full(path):
    return make_path(path["v"][::-1], path["o"][::-1], path["i"][::-1], path["c"])


def reverse_keep_start(path):
    """Reverse direction but keep vertex 0 first, as AE does for closed shapes."""
    n = len(path["v"])
    order = [0] + list(range(n - 1, 0, -1))
    return make_path([path["v"][k] for k in order], [path["o"][k] for k in order],
                     [path["i"][k] for k in order], path["c"])


def reverse_path(path):
    return reverse_keep_start(path) if path["c"] else reverse_full(path)


def transform_path(path, m):
    return make_path([mat_point(m, p) for p in path["v"]], [mat_vector(m, t) for t in path["i"]],
                     [mat_vector(m, t) for t in path["o"]], path["c"])


def segment_count(path):
    n = len(path["v"])
    return n if path["c"] else max(0, n - 1)


def segment_controls(path, k):
    v, i, o = path["v"], path["i"], path["o"]
    k2 = (k + 1) % len(v)
    p0, p3 = v[k], v[k2]
    p1 = (p0[0] + o[k][0], p0[1] + o[k][1])
    p2 = (p3[0] + i[k2][0], p3[1] + i[k2][1])
    return p0, p1, p2, p3


def bezier_length(p0, p1, p2, p3, steps=24):
    total, prev = 0.0, p0
    for s in range(1, steps + 1):
        t = s / float(steps)
        mt = 1.0 - t
        a, b, c, d = mt * mt * mt, 3 * mt * mt * t, 3 * mt * t * t, t * t * t
        pt = (a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1])
        total += math.hypot(pt[0] - prev[0], pt[1] - prev[1])
        prev = pt
    return total


def path_length(path):
    return sum(bezier_length(*segment_controls(path, k)) for k in range(segment_count(path)))


def pad_path(path, target):
    """Split the longest segments in half until the path has `target` vertices.
    The curve is unchanged, so PLA gets a constant point count."""
    path = make_path(path["v"], path["i"], path["o"], path["c"])
    while len(path["v"]) < target and segment_count(path) > 0:
        k = max(range(segment_count(path)), key=lambda s: bezier_length(*segment_controls(path, s), steps=8))
        p0, p1, p2, p3 = segment_controls(path, k)
        mid = lambda a, b: ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
        p01, p12, p23 = mid(p0, p1), mid(p1, p2), mid(p2, p3)
        p012, p123 = mid(p01, p12), mid(p12, p23)
        m = mid(p012, p123)
        k2 = (k + 1) % len(path["v"])
        path["o"][k] = (p01[0] - p0[0], p01[1] - p0[1])
        path["i"][k2] = (p23[0] - p3[0], p23[1] - p3[1])
        at = k + 1
        path["v"].insert(at, m)
        path["i"].insert(at, (p012[0] - m[0], p012[1] - m[1]))
        path["o"].insert(at, (p123[0] - m[0], p123[1] - m[1]))
    return path


def double_loop(path):
    """A closed path as an open one that runs round twice (2n + 1 vertices),
    so a Sweep can grow across the first vertex without a jump."""
    n = len(path["v"])
    order = list(range(n)) * 2 + [0]
    return make_path([path["v"][k] for k in order], [path["i"][k] for k in order],
                     [path["o"][k] for k in order], False)


# ---------------------------------------------------------------------------
# Trim Paths -> growth windows
# ---------------------------------------------------------------------------

def trim_window(trim, fi):
    """Normalised (s, e) with 0 <= s < 1 and s <= e <= s + 1; e > 1 wraps."""
    s = min(1.0, max(0.0, value_at(trim.get("start"), fi, 0.0) / 100.0))
    e = min(1.0, max(0.0, value_at(trim.get("end"), fi, 100.0) / 100.0))
    o = (value_at(trim.get("offset"), fi, 0.0) % 360.0) / 360.0
    s, e = s + o, e + o
    if s > e:
        s, e = e, s
    return normalise_window(s, e)


def normalise_window(s, e):
    if e - s < EPS:
        return (0.0, 0.0)
    if e - s > 1.0 - EPS:
        return (0.0, 1.0)
    while s >= 1.0 - EPS:
        s, e = s - 1.0, e - 1.0
    return (max(0.0, s), e)


def individual_windows(window, lengths):
    """Split one window across paths trimmed one after another (Trim Multiple
    Shapes: Individually), top path first. Mirrors lottie-web's TrimModifier."""
    s, e = window
    total = sum(lengths)
    if total < EPS:
        return [(0.0, 0.0)] * len(lengths)
    if e <= 1.0:
        pieces = [(s, e)]
    else:
        pieces = [(s, 1.0), (0.0, e - 1.0)]
    out, added = [], 0.0
    for length in lengths:
        local = []
        for ps, pe in pieces:
            if pe * total < added or ps * total > added + length or length < EPS:
                continue
            ls = 0.0 if ps * total <= added else (ps * total - added) / length
            le = 1.0 if pe * total >= added + length else (pe * total - added) / length
            if le - ls > EPS:
                local.append((ls, le))
        if not local:
            out.append((0.0, 0.0))
        elif len(local) == 1:
            out.append(normalise_window(*local[0]))
        else:
            # [a, 1] and [0, b] on the same path: one window across the seam
            out.append(normalise_window(local[0][0], 1.0 + local[1][1]))
        added += length
    return out


# ---------------------------------------------------------------------------
# The exported shape tree -> a flat list of drawn paths
# ---------------------------------------------------------------------------

SHAPE_TYPES = ("path", "rect", "ellipse", "star")


class DrawPath(object):
    """One path as After Effects draws it: its group-transform chain, and the
    nearest Stroke and Trim Paths that apply to it."""

    def __init__(self, item, chain, name, stroke, stroke_depth, trim):
        self.item = item
        self.chain = chain
        self.name = name
        self.stroke = stroke
        self.stroke_depth = stroke_depth
        self.trim = trim


def collect_paths(items, warnings, chain=(), inherited=(), prefix=""):
    """A Stroke or Trim Paths applies to every path above it in its own group,
    including paths inside groups above it. The nearest one wins."""
    out = []
    for idx, it in enumerate(items):
        if not it.get("enabled", True):
            continue
        kind = it.get("type")
        below = [(x, len(chain)) for x in items[idx + 1:]
                 if x.get("enabled", True) and x.get("type") in ("stroke", "trim")]
        ops = below + list(inherited)
        if kind == "group":
            out.extend(collect_paths(it.get("contents", []), warnings, chain + (it.get("transform"),),
                                     ops, prefix + it.get("name", "Group") + " / "))
        elif kind in SHAPE_TYPES:
            strokes = [op for op in ops if op[0]["type"] == "stroke"]
            trims = [op for op in ops if op[0]["type"] == "trim"]
            name = prefix + it.get("name", "Path")
            if len(strokes) > 1:
                warnings.add("%s: more than one Stroke applies, only the nearest is swept" % name)
            if len(trims) > 1:
                warnings.add("%s: more than one Trim Paths applies, only the nearest is used" % name)
            stroke, depth = strokes[0] if strokes else (None, 0)
            if stroke is not None and stroke.get("dashes"):
                warnings.add("%s: stroke dashes are ignored" % name)
            out.append(DrawPath(it, chain, name, stroke, depth, trims[0][0] if trims else None))
        elif it.get("mn") in UNSUPPORTED_OPERATORS:
            warnings.add("%s is not supported and was ignored (%s)" % (UNSUPPORTED_OPERATORS[it["mn"]], prefix + it.get("name", "")))
    return out


def raw_path(item, fi):
    kind = item["type"]
    rev = item.get("direction") == AE_REVERSED
    if kind == "path":
        path = ae_shape_to_path(value_at(item["shape"], fi))
        return reverse_path(path) if rev else path
    if kind == "rect":
        return rect_path(value_at(item["size"], fi), value_at(item.get("position"), fi, [0, 0]),
                         value_at(item.get("roundness"), fi, 0.0), rev)
    if kind == "ellipse":
        return ellipse_path(value_at(item["size"], fi), value_at(item.get("position"), fi, [0, 0]), rev)
    return star_path(item.get("starType", AE_STAR), value_at(item["points"], fi, 5),
                     value_at(item.get("position"), fi, [0, 0]), value_at(item.get("rotation"), fi, 0.0),
                     value_at(item.get("innerRadius"), fi, 50.0), value_at(item.get("outerRadius"), fi, 100.0),
                     value_at(item.get("innerRoundness"), fi, 0.0), value_at(item.get("outerRoundness"), fi, 0.0), rev)


def chain_matrix(chain, fi, depth=None):
    m = IDENTITY
    for tr in chain[:depth]:
        m = mat_mul(m, group_matrix(tr, fi))
    return m


def stroke_width(dp, fi):
    """Stroke width in layer pixels: the width is drawn in its own group's
    space, so only the transforms above the Stroke scale it."""
    width = value_at(dp.stroke.get("width"), fi, 0.0)
    return width * mat_area_scale(chain_matrix(dp.chain, fi, dp.stroke_depth))


def trim_windows(paths, frame_count):
    """{id(DrawPath): [(s, e) per frame]} for every trimmed path."""
    groups = {}
    for dp in paths:
        if dp.trim is not None:
            groups.setdefault(id(dp.trim), []).append(dp)
    result = {}
    for members in groups.values():
        trim = members[0].trim
        individually = trim.get("mode") == AE_TRIM_INDIVIDUALLY and len(members) > 1
        per_path = [[] for _ in members]
        for fi in range(frame_count):
            window = trim_window(trim, fi)
            if individually and window != (0.0, 1.0):
                lengths = [path_length(raw_path(dp.item, fi)) for dp in members]
                windows = individual_windows(window, lengths)
            else:
                windows = [window] * len(members)
            for k, w in enumerate(windows):
                per_path[k].append(w)
        for dp, windows in zip(members, per_path):
            result[id(dp)] = windows
    return result


# ---------------------------------------------------------------------------
# AE space -> Cinema 4D space. AE is y down, C4D y up; both look down +z.
# A layer matrix is 12 numbers: X axis, Y axis, Z axis, origin, in AE world px.
# ---------------------------------------------------------------------------

class Space(object):

    def __init__(self, comp, scale, origin_mode, layer_mode):
        self.s = scale
        self.bake = layer_mode == LAYER_BAKE
        if origin_mode == ORIGIN_CENTRE:
            self.ox, self.oy = comp["width"] / 2.0, comp["height"] / 2.0
        else:
            self.ox, self.oy = 0.0, 0.0

    def points(self, path, lm):
        """Layer-space path -> C4D points and (left, right) tangents.

        AE tangents are cubic bezier control offsets. Cinema 4D evaluates a
        tangent as 4/3 of its length (its own Circle, made editable, has
        tangents of 0.415 r, not 0.552 r), so they are scaled by 3/4 or every
        curve bulges outwards."""
        s = self.s
        t_scale = s * C4D_TANGENT
        if self.bake:
            def pt(p):
                x, y = p
                return c4d.Vector((lm[0] * x + lm[3] * y + lm[9] - self.ox) * s,
                                  -(lm[1] * x + lm[4] * y + lm[10] - self.oy) * s,
                                  (lm[2] * x + lm[5] * y + lm[11]) * s)

            def vec(t):
                x, y = t
                return c4d.Vector((lm[0] * x + lm[3] * y) * t_scale, -(lm[1] * x + lm[4] * y) * t_scale,
                                  (lm[2] * x + lm[5] * y) * t_scale)
        else:
            def pt(p):
                return c4d.Vector(p[0] * s, -p[1] * s, 0.0)

            def vec(t):
                return c4d.Vector(t[0] * t_scale, -t[1] * t_scale, 0.0)
        return ([pt(p) for p in path["v"]], [vec(t) for t in path["i"]], [vec(t) for t in path["o"]])

    def width_scale(self, lm):
        """How much the layer matrix scales a stroke, when it is baked in."""
        if not self.bake:
            return 1.0
        x = c4d.Vector(lm[0], lm[1], lm[2])
        y = c4d.Vector(lm[3], lm[4], lm[5])
        return math.sqrt((x.Cross(y)).GetLength())

    def null_matrix(self, lm):
        """The layer transform as a C4D matrix, for the layer's Null."""
        s = self.s
        off = c4d.Vector((lm[9] - self.ox) * s, -(lm[10] - self.oy) * s, lm[11] * s)
        v1 = c4d.Vector(lm[0], -lm[1], lm[2])
        v2 = c4d.Vector(-lm[3], lm[4], -lm[5])
        v3 = c4d.Vector(lm[6], -lm[7], lm[8])
        if v3.GetLength() < EPS:
            v3 = v1.Cross(v2).GetNormalized()
        return c4d.Matrix(off, v1, v2, v3)


# ---------------------------------------------------------------------------
# Keys. Every exported frame is a candidate key, interpolated linearly, and
# any key equal to both its neighbours is dropped, so static stretches cost
# nothing and the curve between the remaining keys is unchanged.
# ---------------------------------------------------------------------------

def keep_flags(values, same):
    n = len(values)
    return [k == 0 or k == n - 1 or not (same(values[k - 1], values[k]) and same(values[k], values[k + 1]))
            for k in range(n)]


def floats_same(a, b):
    return abs(a - b) < 1e-5


def real_id(*ids):
    if len(ids) == 1:
        return c4d.DescID(c4d.DescLevel(ids[0], c4d.DTYPE_REAL, 0))
    return c4d.DescID(c4d.DescLevel(ids[0], c4d.DTYPE_VECTOR, 0), c4d.DescLevel(ids[1], c4d.DTYPE_REAL, 0))


def key_float(op, descid, values, times):
    """Set a float parameter, and key it only if it changes."""
    op[descid] = values[0]
    if all(floats_same(values[0], v) for v in values):
        return
    track = c4d.CTrack(op, descid)
    op.InsertTrackSorted(track)
    curve = track.GetCurve()
    for value, time, keep in zip(values, times, keep_flags(values, floats_same)):
        if keep:
            key = curve.AddKey(time)["key"]
            key.SetValue(curve, value)
            key.SetInterpolation(curve, c4d.CINTERPOLATION_LINEAR)


def key_visibility(op, in_frame, out_frame, frames, times):
    """Hide the layer's Null outside the layer's in and out points."""
    first, last = frames[0], frames[-1]
    if in_frame <= first and out_frame > last:
        return
    changes = [(times[0], c4d.MODE_UNDEF if in_frame <= first < out_frame else c4d.MODE_OFF)]
    for frame, mode in ((in_frame, c4d.MODE_UNDEF), (out_frame, c4d.MODE_OFF)):
        if first < frame <= last:
            changes.append((times[frames.index(frame)], mode))
    for param in (c4d.ID_BASEOBJECT_VISIBILITY_EDITOR, c4d.ID_BASEOBJECT_VISIBILITY_RENDER):
        descid = c4d.DescID(c4d.DescLevel(param, c4d.DTYPE_LONG, 0))
        track = c4d.CTrack(op, descid)
        op.InsertTrackSorted(track)
        curve = track.GetCurve()
        for time, mode in changes:
            key = curve.AddKey(time)["key"]
            key.SetGeData(curve, mode)
            key.SetInterpolation(curve, c4d.CINTERPOLATION_STEP)
        op[descid] = changes[0][1]


def geometry_same(a, b):
    for list_a, list_b in zip(a, b):
        for va, vb in zip(list_a, list_b):
            if (va - vb).GetLengthSquared() > 1e-8:
                return False
    return True


def build_spline(doc, parent, name, frames_geo, closed, times):
    """A bezier spline, with Point Level Animation when the geometry moves."""
    count = len(frames_geo[0][0])
    spline = c4d.SplineObject(count, c4d.SPLINETYPE_BEZIER)
    spline.SetName(name)
    spline[c4d.SPLINEOBJECT_CLOSED] = closed
    spline.InsertUnderLast(parent)

    def apply(geo):
        pts, lefts, rights = geo
        spline.SetAllPoints(pts)
        for k in range(count):
            spline.SetTangent(k, lefts[k], rights[k])
        spline.Message(c4d.MSG_UPDATE)

    if all(geometry_same(frames_geo[0], g) for g in frames_geo[1:]):
        apply(frames_geo[0])
        return spline
    track = c4d.CTrack(spline, c4d.DescID(c4d.DescLevel(c4d.CTpla, c4d.CTpla, 0)))
    spline.InsertTrackSorted(track)
    curve = track.GetCurve()
    for geo, time, keep in zip(frames_geo, times, keep_flags(frames_geo, geometry_same)):
        if keep:
            apply(geo)
            key = curve.AddKey(time)["key"]
            track.FillKey(doc, spline, key)
            key.SetInterpolation(curve, c4d.CINTERPOLATION_LINEAR)
    apply(frames_geo[0])
    return spline


def set_display_color(op, color):
    if color:
        op[c4d.ID_BASEOBJECT_USECOLOR] = c4d.ID_BASEOBJECT_USECOLOR_ALWAYS
        op[c4d.ID_BASEOBJECT_COLOR] = c4d.Vector(*color[:3])


def build_sweep(doc, parent, name, frames_geo, closed, times, radii, growth, cap, color):
    sweep = c4d.BaseObject(c4d.Osweep)
    sweep.SetName(name)
    sweep.InsertUnderLast(parent)
    set_display_color(sweep, color)

    profile = c4d.BaseObject(c4d.Osplinecircle)
    profile.SetName("Stroke Width")
    profile.InsertUnder(sweep)
    key_float(profile, real_id(c4d.PRIM_CIRCLE_RADIUS), radii, times)

    if not closed and cap in (AE_CAP_ROUND, AE_CAP_PROJECTING):
        # An outside bevel as deep as the tube's radius reaches past the path's
        # end by half the stroke width, which is exactly what AE's caps do.
        sweep[c4d.CAPSANDBEVELS_STARTBEVEL_TYPE] = 0 if cap == AE_CAP_ROUND else 1
        sweep[c4d.CAPSANDBEVELS_STARTBEVEL_SEGMENTS] = 4 if cap == AE_CAP_ROUND else 1
        sweep[c4d.CAPSANDBEVELS_BEVEL_OUTSIDE] = True
        key_float(sweep, real_id(c4d.CAPSANDBEVELS_STARTBEVEL_OFFSET), radii, times)

    if growth is not None:
        key_float(sweep, real_id(c4d.SWEEPOBJECT_STARTGROWTH), [w[0] for w in growth], times)
        key_float(sweep, real_id(c4d.SWEEPOBJECT_GROWTH), [w[1] for w in growth], times)

    build_spline(doc, sweep, name, frames_geo, closed, times)
    return sweep


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

class Options(object):

    def __init__(self, scale=1.0, origin=ORIGIN_CENTRE, layer_mode=LAYER_BAKE, sweeps=True, match_fps=True):
        self.scale = scale
        self.origin = origin
        self.layer_mode = layer_mode
        self.sweeps = sweeps
        self.match_fps = match_fps


def path_geometry(dp, layer, space, frame_count, warnings, double=False):
    paths = []
    for fi in range(frame_count):
        paths.append(transform_path(raw_path(dp.item, fi), chain_matrix(dp.chain, fi)))
    closed = paths[0]["c"]
    if any(p["c"] != closed for p in paths):
        warnings.add("%s: opens and closes over time, imported as %s" % (dp.name, "closed" if closed else "open"))
    target = max(len(p["v"]) for p in paths)
    if any(len(p["v"]) != target for p in paths):
        warnings.add("%s: vertex count changes over time, extra vertices were added so PLA can key it" % dp.name)
    geo = []
    for fi, path in enumerate(paths):
        path = pad_path(make_path(path["v"], path["i"], path["o"], closed), target)
        if double:
            path = double_loop(path)
        geo.append(space.points(path, value_at(layer["matrix"], fi)))
    return geo, closed


def key_null_transform(null, layer, space, times, frame_count, warnings):
    mats = [space.null_matrix(value_at(layer["matrix"], fi)) for fi in range(frame_count)]
    m0 = mats[0]
    if abs(m0.v1.GetNormalized().Dot(m0.v2.GetNormalized())) > 1e-3:
        warnings.add("%s: the layer transform is skewed (non-uniform scale under a rotated parent); "
                     "a Null can't hold skew, use Bake instead" % layer["name"])
    if not is_animated(layer.get("matrix")):
        null.SetMl(m0)
        return
    channels = {}
    prev_rot = None
    for m in mats:
        null.SetMl(m)
        rot = null.GetRelRot()
        if prev_rot is not None:
            rot = c4d.utils.GetOptimalAngle(prev_rot, rot, null.GetRotationOrder())
        prev_rot = rot
        for pid, vec in ((c4d.ID_BASEOBJECT_REL_POSITION, null.GetRelPos()),
                         (c4d.ID_BASEOBJECT_REL_ROTATION, rot),
                         (c4d.ID_BASEOBJECT_REL_SCALE, null.GetRelScale())):
            for cid, comp in ((c4d.VECTOR_X, vec.x), (c4d.VECTOR_Y, vec.y), (c4d.VECTOR_Z, vec.z)):
                channels.setdefault((pid, cid), []).append(comp)
    for (pid, cid), values in channels.items():
        key_float(null, real_id(pid, cid), values, times)


def import_layer(doc, layer, data, space, opts, times, warnings, pred):
    frames = data["frames"]
    frame_count = len(frames)
    null = c4d.BaseObject(c4d.Onull)
    null.SetName(layer["name"])
    doc.InsertObject(null, pred=pred)
    if not space.bake:
        key_null_transform(null, layer, space, times, frame_count, warnings)
    key_visibility(null, layer.get("inFrame", frames[0]), layer.get("outFrame", frames[-1] + 1), frames, times)

    paths = collect_paths(layer.get("contents", []), warnings)
    if not paths:
        warnings.add("%s: no paths found" % layer["name"])
    windows = trim_windows(paths, frame_count)
    for dp in paths:
        stroke = dp.stroke if opts.sweeps else None
        if stroke is None:
            geo, closed = path_geometry(dp, layer, space, frame_count, warnings)
            build_spline(doc, null, dp.name, geo, closed, times)
            continue
        if stroke.get("gradient"):
            warnings.add("%s: gradient stroke swept without its colour" % dp.name)
        color = value_at(stroke.get("color"), 0)
        cap = stroke.get("cap", 1)
        radii = [stroke_width(dp, fi) * space.width_scale(value_at(layer["matrix"], fi)) * opts.scale / 2.0
                 for fi in range(frame_count)]
        win = windows.get(id(dp))
        wraps = win is not None and any(e > 1.0 + EPS for _, e in win)
        closed = raw_path(dp.item, 0)["c"]

        if closed and wraps:
            geo, _ = path_geometry(dp, layer, space, frame_count, warnings, double=True)
            growth = [(s / 2.0, e / 2.0) for s, e in win]
            build_sweep(doc, null, dp.name, geo, False, times, radii, growth, None, color)
        elif closed:
            geo, _ = path_geometry(dp, layer, space, frame_count, warnings)
            build_sweep(doc, null, dp.name, geo, True, times, radii, win, cap, color)
        else:
            geo, _ = path_geometry(dp, layer, space, frame_count, warnings)
            growth = None if win is None else [(s, min(e, 1.0)) if e - s > EPS else (0.0, 0.0) for s, e in win]
            build_sweep(doc, null, dp.name, geo, False, times, radii, growth, cap, color)
            if wraps:
                wrap = [(0.0, e - 1.0) if e - 1.0 > EPS else (0.0, 0.0) for _, e in win]
                build_sweep(doc, null, dp.name + " (wrap)", geo, False, times, radii, wrap, cap, color)
    return null


def import_data(doc, data, opts):
    """Build everything in `doc`. Returns (layer Nulls, warnings)."""
    if data.get("format") != FORMAT:
        raise ValueError("Not a shape export from ExportShapesToC4D.jsx")
    comp = data["comp"]
    frames = data["frames"]
    if not frames:
        raise ValueError("The export contains no frames")
    ae_fps = comp["frameRate"]
    if opts.match_fps:
        fps = int(round(ae_fps))
        doc.SetFps(fps)
        doc.SetMinTime(c4d.BaseTime(frames[0], fps))
        doc.SetMaxTime(c4d.BaseTime(frames[-1], fps))
        doc.SetLoopMinTime(c4d.BaseTime(frames[0], fps))
        doc.SetLoopMaxTime(c4d.BaseTime(frames[-1], fps))
        times = [c4d.BaseTime(f, fps) for f in frames]
    else:
        times = [c4d.BaseTime(f / float(ae_fps)) for f in frames]

    warnings = set()
    if abs(comp.get("pixelAspect", 1.0) - 1.0) > 1e-3:
        warnings.add("The comp has non-square pixels; points are in AE pixels, not display pixels")
    space = Space(comp, opts.scale, opts.origin, opts.layer_mode)
    nulls = []
    pred = None
    for layer in data["layers"]:
        pred = import_layer(doc, layer, data, space, opts, times, warnings, pred)
        nulls.append(pred)
    return nulls, sorted(warnings)


# ---------------------------------------------------------------------------
# Dialog
# ---------------------------------------------------------------------------

ID_SCALE, ID_ORIGIN, ID_LAYER, ID_SWEEPS, ID_FPS = 1000, 1001, 1002, 1003, 1004


class ImportDialog(c4d.gui.GeDialog):

    def __init__(self, data):
        super(ImportDialog, self).__init__()
        self.data = data
        self.options = None

    def CreateLayout(self):
        self.SetTitle(TITLE)
        comp, frames, layers = self.data["comp"], self.data["frames"], self.data["layers"]
        self.GroupBorderSpace(12, 10, 12, 10)
        self.AddStaticText(0, c4d.BFH_SCALEFIT, name="%s  -  %d layer%s, frames %d-%d at %g fps" % (
            comp["name"], len(layers), "" if len(layers) == 1 else "s", frames[0], frames[-1], comp["frameRate"]))
        self.AddSeparatorH(0)

        if self.GroupBegin(0, c4d.BFH_SCALEFIT, 2, 0):
            self.GroupSpace(8, 6)
            self.AddStaticText(0, c4d.BFH_LEFT, name="1 px =")
            self.AddEditNumberArrows(ID_SCALE, c4d.BFH_SCALEFIT, 80)
            self.AddStaticText(0, c4d.BFH_LEFT, name="Origin")
            self.AddComboBox(ID_ORIGIN, c4d.BFH_SCALEFIT, 200)
            self.AddChild(ID_ORIGIN, ORIGIN_CENTRE, "Comp centre")
            self.AddChild(ID_ORIGIN, ORIGIN_TOPLEFT, "Comp top-left")
            self.AddStaticText(0, c4d.BFH_LEFT, name="Layer transform")
            self.AddComboBox(ID_LAYER, c4d.BFH_SCALEFIT, 200)
            self.AddChild(ID_LAYER, LAYER_BAKE, "Bake into the points")
            self.AddChild(ID_LAYER, LAYER_NULL, "Animate the layer's Null")
        self.GroupEnd()

        self.AddCheckbox(ID_SWEEPS, c4d.BFH_LEFT, 0, 0, "Strokes become Sweeps, Trim Paths drive growth")
        self.AddCheckbox(ID_FPS, c4d.BFH_LEFT, 0, 0, "Set project frame rate and range to match")
        self.AddDlgGroup(c4d.DLG_OK | c4d.DLG_CANCEL)
        return True

    def InitValues(self):
        self.SetFloat(ID_SCALE, 1.0, min=0.0001, max=100000.0, step=0.1, format=c4d.FORMAT_FLOAT)
        self.SetInt32(ID_ORIGIN, ORIGIN_CENTRE)
        self.SetInt32(ID_LAYER, LAYER_BAKE)
        self.SetBool(ID_SWEEPS, True)
        self.SetBool(ID_FPS, True)
        return True

    def Command(self, cid, msg):
        if cid == c4d.DLG_OK:
            self.options = Options(self.GetFloat(ID_SCALE), self.GetInt32(ID_ORIGIN), self.GetInt32(ID_LAYER),
                                   self.GetBool(ID_SWEEPS), self.GetBool(ID_FPS))
            self.Close()
        elif cid == c4d.DLG_CANCEL:
            self.Close()
        return True


def main():
    doc = c4d.documents.GetActiveDocument()
    if doc is None:
        return
    path = c4d.storage.LoadDialog(c4d.FILESELECTTYPE_ANYTHING, "Open a shape export from After Effects",
                                  c4d.FILESELECT_LOAD, "json")
    if not path:
        return
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError) as err:
        c4d.gui.MessageDialog("Could not read %s\n\n%s" % (path, err))
        return
    if not isinstance(data, dict) or data.get("format") != FORMAT:
        c4d.gui.MessageDialog("That file isn't a shape export from ExportShapesToC4D.jsx.")
        return

    dialog = ImportDialog(data)
    dialog.Open(c4d.DLG_TYPE_MODAL, defaultw=420)
    if dialog.options is None:
        return

    doc.StartUndo()
    doc.AddUndo(c4d.UNDOTYPE_CHANGE_SMALL, doc)
    try:
        nulls, warnings = import_data(doc, data, dialog.options)
    except Exception as err:
        doc.EndUndo()
        c4d.gui.MessageDialog("Import failed: %s" % err)
        raise
    doc.SetActiveObject(None, c4d.SELECTION_NEW)
    for null in nulls:
        doc.AddUndo(c4d.UNDOTYPE_NEWOBJ, null)
        doc.SetActiveObject(null, c4d.SELECTION_ADD)
    doc.EndUndo()
    c4d.EventAdd()

    if warnings:
        for line in warnings:
            print("%s: %s" % (TITLE, line))
        shown = warnings[:12]
        more = len(warnings) - len(shown)
        c4d.gui.MessageDialog("Imported %d layer%s, with notes:\n\n- %s%s" % (
            len(nulls), "" if len(nulls) == 1 else "s", "\n- ".join(shown),
            "\n\n(%d more in the console)" % more if more else ""))


if __name__ == "__main__":
    main()
