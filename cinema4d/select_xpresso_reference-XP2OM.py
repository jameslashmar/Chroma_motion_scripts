"""
Reverse lookup: select node(s) in the XPresso editor, run this script.
It finds whatever those nodes reference and takes you to it:

- an object or tag is selected in the Object Manager, with the hierarchy
  expanded so it's actually visible;
- a material is selected in the Material Manager;
- a node inside a material's graph - the thing you get by dragging a node
  from the Node Editor (or a Redshift shader graph) into XPresso - has its
  material selected, its graph opened, and that node selected and framed.

Cinema 4D 2026+ / Python API
"""

import c4d
import maxon
from c4d.modules import graphview

# --- settings -------------------------------------------------------------

# Open the graph a referenced material node lives in, and frame the node.
OPEN_MATERIAL_GRAPH = True
FRAME_NODE = True

# When a node references a whole material rather than a node inside it, open
# that material's graph as well as selecting it in the Material Manager.
OPEN_GRAPH_FOR_PLAIN_MATERIAL = True

# Zoom to land on in a legacy Redshift shader graph. 1.0 = 100%. The Node
# Editor frames the node itself, so this only applies to the legacy editor.
CENTRE_ZOOM = 1.0

XPRESSO_EDITOR_ID = 1001148           # the classic XPresso editor dialog
NODE_EDITOR_FRAME_SELECTED = 465002307  # "Frame Selected", Node Editor

# View transform of a classic graph (XPresso or legacy Redshift), on the root
# XGroup's operator container. See docs/xpresso-api-notes.md.
VIEW_ZOOM_ID = 104
VIEW_SCROLL_IDS = (102, 103)
NODE_POS_IDS = (100, 101)
NODE_SIZE_IDS = (108, 109)

# How a material node ends up referenced by XPresso:
#
# 1. Node Editor materials (Redshift, Standard, any node space). The graph
#    itself is not made of BaseList2D, so C4D keeps a stand-in BaseList2D per
#    node or port that something classic points at - an animation track, or
#    an XPresso node. They sit in the material's "Nodes" branch, type
#    300001078, and are what the XPresso node's link resolves to. They are not
#    materials, objects or tags, which is why this script used to list them
#    as referenced and then select nothing.
#
#    stand-in.GetMain()                        -> the material
#    material.GetAllNimbusRefs()               -> [(node space id, nimbus)]
#    nimbus.GetGraphNodeFromBaseList(stand-in) -> the maxon.GraphNode
#
#    GetGraphNodeFromBaseList answers from whichever graph really owns the
#    stand-in, whatever nimbus it is called on. A material carrying graphs for
#    two node spaces therefore returns the same node twice; the nimbus whose
#    GetGraph() equals the node's GetGraph() is the right one to open.
#
# 2. Legacy Redshift shader graphs are XPresso graphs themselves, so the link
#    resolves to a plain GvNode. node.GetNodeMaster().GetOwner() is the
#    material.


def collect_nodes(node, out):
    """Recursively collect every GvNode, including those nested in XGroups."""
    while node:
        out.append(node)
        collect_nodes(node.GetDown(), out)
        node = node.GetNext()


def get_op_container(node):
    """The node's data container - where its links live."""
    for name in ("GetOpContainerInstance", "GetOperatorContainer", "GetDataInstance"):
        fn = getattr(node, name, None)
        if fn:
            try:
                bc = fn()
                if bc is not None:
                    return bc
            except Exception:
                pass
    return None


def container_ids(bc):
    """Every parameter id in a BaseContainer, without touching the values."""
    ids = []

    get_index_id = getattr(bc, "GetIndexId", None)
    if get_index_id:
        try:
            count = len(bc)
        except Exception:
            count = None
        if count is not None:
            for i in range(count):
                cid = get_index_id(i)
                if cid == c4d.NOTOK:
                    break
                ids.append(cid)
            return ids

    try:
        for item in bc:
            ids.append(item[0])
    except Exception:
        pass
    return ids


def node_links(node, doc):
    """Every element this node links to."""
    links = []
    bc = get_op_container(node)
    if bc is None:
        return links

    for cid in container_ids(bc):
        try:
            linked = bc.GetLink(cid, doc)
        except Exception:
            continue
        if linked is not None:
            links.append(linked)
    return links


def all_xpresso_tags(doc):
    """Every XPresso tag in the scene, wherever it lives in the hierarchy."""
    found = []

    def walk(op):
        while op:
            tag = op.GetFirstTag()
            while tag:
                if tag.GetType() == c4d.Texpresso:
                    found.append((op, tag))
                tag = tag.GetNext()
            walk(op.GetDown())
            op = op.GetNext()

    walk(doc.GetFirstObject())
    return found


def reveal_in_om(op):
    """Unfold every ancestor so the object is visible in the Object Manager."""
    parent = op.GetUp()
    while parent:
        for bit in (c4d.NBIT_OM1_FOLD, c4d.NBIT_OM2_FOLD,
                    c4d.NBIT_OM3_FOLD, c4d.NBIT_OM4_FOLD):
            try:
                parent.ChangeNBit(bit, c4d.NBITCONTROL_SET)
            except Exception:
                pass
        parent = parent.GetUp()


# --- material graph nodes (Node Editor) -----------------------------------

class GraphHit(object):
    """One Node Editor node referenced from XPresso."""

    def __init__(self, owner, space_id, nimbus, graph, node, node_name, port_name):
        self.owner = owner            # the material (or other graph owner)
        self.space_id = space_id
        self.nimbus = nimbus
        self.graph = graph
        self.node = node              # the true node, never a port
        self.node_name = node_name
        self.port_name = port_name    # set when the link was to a port


def graph_node_name(node, fallback):
    try:
        name = str(node.GetValue(maxon.EffectiveName))
        if name:
            return name
    except Exception:
        pass
    return fallback


def resolve_graph_node(linked):
    """
    Turn a linked stand-in BaseList2D into the graph node it stands for.
    Returns a GraphHit, or None if `linked` isn't a graph node stand-in.
    """
    try:
        owner = linked.GetMain()
        refs = owner.GetAllNimbusRefs() if owner is not None else []
    except Exception:
        return None

    for space_id, nimbus in refs:
        try:
            found = nimbus.GetGraphNodeFromBaseList(linked)
            if found is None or found.IsNullValue() or not found.IsValid():
                continue
            graph = nimbus.GetGraph()
            # The lookup answers from the owning graph whichever nimbus is
            # asked, so check this nimbus is the one that holds it.
            if found.GetGraph() != graph:
                continue

            node = found
            port_name = None
            if found.GetKind() != maxon.NODE_KIND.NODE:
                node = found.GetAncestor(maxon.NODE_KIND.NODE)
                port_name = linked.GetName()
                if node is None or node.IsNullValue():
                    continue

            name = graph_node_name(node, linked.GetName() if port_name is None else "?")
            return GraphHit(owner, space_id, nimbus, graph, node, name, port_name)
        except Exception:
            continue
    return None


def select_graph_nodes(graph, nodes):
    """Make `nodes` the selection in their graph. Needs a transaction."""
    with graph.BeginTransaction() as transaction:
        maxon.GraphModelHelper.DeselectAll(graph, maxon.NODE_KIND.NODE)
        for node in nodes:
            maxon.GraphModelHelper.SelectNode(node)
        transaction.Commit()


def open_node_editor(nimbus, group_path=None):
    """Open the Node Editor on this graph, inside `group_path` if given."""
    if group_path is not None:
        try:
            nimbus.OpenInEditor(group_path)
            return
        except Exception:
            pass
    nimbus.OpenInEditor()


def frame_in_node_editor():
    """Frame the selected node. False when the editor wouldn't take the command."""
    try:
        if not c4d.IsCommandEnabled(NODE_EDITOR_FRAME_SELECTED):
            return False
        c4d.CallCommand(NODE_EDITOR_FRAME_SELECTED)
        return True
    except Exception:
        return False


def enclosing_group_path(node):
    """Path of the group a node sits in, or None when it is at the top level."""
    try:
        parent = node.GetParent()
        if parent is None or parent.IsNullValue() or parent.IsRoot():
            return None
        return parent.GetPath()
    except Exception:
        return None


def activate_owner(doc, owner, first):
    """Select a graph's owner - normally a material - in its manager."""
    mode = c4d.SELECTION_NEW if first else c4d.SELECTION_ADD
    if isinstance(owner, c4d.BaseMaterial):
        doc.SetActiveMaterial(owner, mode)
    elif isinstance(owner, c4d.BaseObject):
        reveal_in_om(owner)
        doc.SetActiveObject(owner, mode)
    elif isinstance(owner, c4d.BaseTag):
        host = owner.GetObject()
        if host:
            reveal_in_om(host)
        doc.SetActiveTag(owner, mode)


def show_graph_hits(doc, hits):
    """Select every referenced graph node, then open the first graph."""
    graphs = []                       # [[first hit, [nodes]]], one per graph
    for hit in hits:
        for entry in graphs:
            if entry[0].graph == hit.graph:
                if not any(hit.node == n for n in entry[1]):
                    entry[1].append(hit.node)
                break
        else:
            graphs.append([hit, [hit.node]])

    for i, (hit, nodes) in enumerate(graphs):
        activate_owner(doc, hit.owner, i == 0)
        try:
            select_graph_nodes(hit.graph, nodes)
        except Exception as exc:
            print("couldn't select in the graph of '%s': %s" % (hit.owner.GetName(), exc))
    c4d.EventAdd()

    if not OPEN_MATERIAL_GRAPH:
        return False

    hit, nodes = graphs[0]
    if len(graphs) > 1:
        others = ", ".join("'%s'" % g[0].owner.GetName() for g in graphs[1:])
        print("showing the graph of '%s' - nodes are also selected in %s"
              % (hit.owner.GetName(), others))

    try:
        open_node_editor(hit.nimbus, enclosing_group_path(nodes[0]))
    except Exception as exc:
        print("couldn't open the Node Editor: %s - the node is still selected" % exc)
        return False

    if FRAME_NODE and not frame_in_node_editor():
        print("Node Editor opened; it didn't take Frame Selected from a script - "
              "the node is selected, so View > Frame Selected in the editor lands on it")
    return True


# --- legacy Redshift shader graphs (and any other classic graph) -----------

def operator_container(node):
    """A classic node's operator container: position, size, and on the root the view."""
    try:
        data = node.GetDataInstance()
        if data is None:
            return None
        shape = data.GetContainerInstance(c4d.ID_SHAPECONTAINER)
        if shape is None:
            return None
        return shape.GetContainerInstance(c4d.ID_OPERATORCONTAINER)
    except Exception:
        return None


def node_centre(node):
    bc = operator_container(node)
    if bc is None:
        return None
    try:
        x = float(bc[NODE_POS_IDS[0]])
        y = float(bc[NODE_POS_IDS[1]])
        w = float(bc[NODE_SIZE_IDS[0]])
        h = float(bc[NODE_SIZE_IDS[1]])
    except Exception:
        return None
    return (x + w / 2.0, y + h / 2.0)


def top_level_ancestor(node, root):
    """The node on the root canvas that holds `node` (itself, if not nested)."""
    current = node
    while True:
        parent = current.GetUp()
        if parent is None or parent == root:
            return current
        current = parent


def centre_classic_view(master, nodes):
    """Centre a classic graph's view on `nodes`. View centre = -scroll."""
    root = master.GetRoot()
    bc = operator_container(root) if root else None
    if bc is None:
        return False

    points = []
    for node in nodes:
        p = node_centre(top_level_ancestor(node, root))
        if p:
            points.append(p)
    if not points:
        return False

    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    try:
        bc.SetFloat(VIEW_ZOOM_ID, float(CENTRE_ZOOM))
        bc.SetFloat(VIEW_SCROLL_IDS[0], -(min(xs) + max(xs)) / 2.0)
        bc.SetFloat(VIEW_SCROLL_IDS[1], -(min(ys) + max(ys)) / 2.0)
    except Exception:
        return False
    return True


def open_classic_graph(doc, owner, master):
    """Open the editor that shows this classic graph. False if there isn't one."""
    button = getattr(c4d, "REDSHIFT_GRAPH_BUTTON_EDIT", None)
    if isinstance(owner, c4d.BaseMaterial) and button is not None:
        c4d.CallButton(owner, button)             # "Edit Shader Graph..."
        return True
    if isinstance(owner, c4d.BaseTag) and owner.GetType() == c4d.Texpresso:
        return bool(graphview.OpenDialog(XPRESSO_EDITOR_ID, master))
    return False


def show_classic_hits(doc, gv_nodes, first):
    """Select referenced GvNodes in their own graphs, then open the first."""
    masters = []                      # [[master, owner, [nodes]]]
    for node in gv_nodes:
        master = node.GetNodeMaster()
        if master is None:
            continue
        for entry in masters:
            if entry[0] == master:
                entry[2].append(node)
                break
        else:
            masters.append([master, master.GetOwner(), [node]])

    for i, (master, owner, nodes) in enumerate(masters):
        everything = []
        root = master.GetRoot()
        if root:
            collect_nodes(root.GetDown(), everything)
        for node in everything:
            node.DelBit(c4d.BIT_ACTIVE)
        for node in nodes:
            node.SetBit(c4d.BIT_ACTIVE)
        if owner is not None:
            activate_owner(doc, owner, first and i == 0)
        graphview.RedrawMaster(master)
    c4d.EventAdd()

    if not masters or not OPEN_MATERIAL_GRAPH:
        return False

    master, owner, nodes = masters[0]
    try:
        opened = open_classic_graph(doc, owner, master)
    except Exception as exc:
        print("couldn't open the shader graph: %s - the node is still selected" % exc)
        return False
    if not opened:
        print("no editor to open for the graph on '%s' - the node is still selected"
              % (owner.GetName() if owner is not None else "?"))
        return False

    if FRAME_NODE and centre_classic_view(master, nodes):
        graphview.RedrawMaster(master)
        c4d.EventAdd()
    return True


# --- plain material references --------------------------------------------

def open_material_graph(doc, mat):
    """Open whichever graph a material has. False for a classic material."""
    try:
        refs = mat.GetAllNimbusRefs()
    except Exception:
        refs = []
    if refs:
        try:
            active = str(c4d.GetActiveNodeSpaceId())
        except Exception:
            active = None
        chosen = refs[0][1]
        for space_id, nimbus in refs:
            if str(space_id) == active:
                chosen = nimbus
                break
        open_node_editor(chosen)
        return True

    try:
        import redshift
        master = redshift.GetRSMaterialNodeMaster(mat)
    except Exception:
        master = None
    if master is not None:
        return open_classic_graph(doc, mat, master)
    return False


# --- reporting ------------------------------------------------------------

def describe(element):
    """Readable path for an element, so the console tells you where it went."""
    if isinstance(element, GraphHit):
        where = "%s '%s'" % (
            "material" if isinstance(element.owner, c4d.BaseMaterial) else "graph on",
            element.owner.GetName())
        if element.port_name:
            return "port '%s' of node '%s' in %s" % (element.port_name, element.node_name, where)
        return "node '%s' in %s" % (element.node_name, where)

    name = element.GetName()
    if isinstance(element, graphview.GvNode):
        master = element.GetNodeMaster()
        owner = master.GetOwner() if master else None
        return "graph node '%s' in '%s'" % (name, owner.GetName() if owner else "?")
    if isinstance(element, c4d.BaseTag):
        host = element.GetObject()
        return "tag '%s' on object '%s'" % (name, host.GetName() if host else "?")
    if isinstance(element, c4d.BaseMaterial):
        return "material '%s'" % name
    if isinstance(element, c4d.BaseObject):
        path = [name]
        parent = element.GetUp()
        while parent:
            path.insert(0, parent.GetName())
            parent = parent.GetUp()
        return "object '%s'" % " / ".join(path)
    return "%s '%s'" % (type(element).__name__, name)


def main():
    doc = c4d.documents.GetActiveDocument()
    if not doc:
        print("No active document")
        return

    # gather every selected node across every XPresso graph in the scene
    selected_nodes = []
    for host, tag in all_xpresso_tags(doc):
        master = tag.GetNodeMaster()
        if not master:
            continue
        root = master.GetRoot()
        if not root:
            continue

        nodes = []
        collect_nodes(root.GetDown(), nodes)
        for node in nodes:
            if node.GetBit(c4d.BIT_ACTIVE):
                selected_nodes.append((host, node))

    if not selected_nodes:
        print("No XPresso nodes selected - click a node in the XPresso editor first")
        return

    print("%d node(s) selected:" % len(selected_nodes))

    # Collect referenced elements, de-duplicated, order preserved. A stand-in
    # for a material graph node is swapped for the GraphHit it resolves to.
    raw = []
    targets = []
    for host, node in selected_nodes:
        resolved = []
        for linked in node_links(node, doc):
            known = None
            for seen, target in raw:
                if seen == linked:
                    known = target
                    break
            if known is None:
                known = linked
                if not isinstance(linked, (graphview.GvNode, c4d.BaseObject,
                                           c4d.BaseTag, c4d.BaseMaterial)):
                    known = resolve_graph_node(linked) or linked
                raw.append((linked, known))
                targets.append(known)
            resolved.append(known)

        print("  %s  (on '%s')  -> %s" % (
            node.GetName(),
            host.GetName(),
            ", ".join(describe(r) for r in resolved) if resolved else "no reference"))

    if not targets:
        print("\nNothing referenced by those nodes")
        return

    graph_hits = [t for t in targets if isinstance(t, GraphHit)]
    gv_nodes = [t for t in targets if isinstance(t, graphview.GvNode)]
    objects = [t for t in targets if isinstance(t, c4d.BaseObject)]
    tags = [t for t in targets if isinstance(t, c4d.BaseTag)]
    materials = [t for t in targets if isinstance(t, c4d.BaseMaterial)]
    handled = graph_hits + gv_nodes + objects + tags + materials
    unknown = [t for t in targets if not any(t is h for h in handled)]

    print("")

    # objects - plus the host object of any referenced tag, so it's on screen
    first = True
    for op in objects:
        reveal_in_om(op)
        doc.SetActiveObject(op, c4d.SELECTION_NEW if first else c4d.SELECTION_ADD)
        first = False
        print("selected %s" % describe(op))

    for tg in tags:
        host = tg.GetObject()
        if host:
            reveal_in_om(host)
            doc.SetActiveObject(host, c4d.SELECTION_NEW if first else c4d.SELECTION_ADD)
            first = False
        doc.SetActiveTag(tg, c4d.SELECTION_NEW if tg is tags[0] else c4d.SELECTION_ADD)
        print("selected %s" % describe(tg))

    for mat in materials:
        doc.SetActiveMaterial(mat, c4d.SELECTION_NEW if mat is materials[0] else c4d.SELECTION_ADD)
        print("selected %s" % describe(mat))

    c4d.EventAdd()

    # Material graph nodes. These run after the plain selections because the
    # Node Editor follows the active material: the graph being opened has to
    # be the last thing made active.
    opened = False
    if gv_nodes:
        for node in gv_nodes:
            print("selected %s" % describe(node))
        opened = show_classic_hits(doc, gv_nodes, not materials) or opened

    if graph_hits:
        for hit in graph_hits:
            print("selected %s" % describe(hit))
        opened = show_graph_hits(doc, graph_hits) or opened

    if (materials and not opened and OPEN_MATERIAL_GRAPH
            and OPEN_GRAPH_FOR_PLAIN_MATERIAL):
        try:
            if open_material_graph(doc, materials[0]):
                print("opened the graph of %s" % describe(materials[0]))
        except Exception as exc:
            print("couldn't open the graph of %s: %s" % (describe(materials[0]), exc))

    for element in unknown:
        print("can't select %s - it isn't an object, tag, material or graph node"
              % describe(element))

    c4d.EventAdd()


if __name__ == '__main__':
    main()
