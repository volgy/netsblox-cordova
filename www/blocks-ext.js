/* global nop, ScriptsMorph, BlockMorph, InputSlotMorph, StringMorph, Color
   ReporterBlockMorph, CommandBlockMorph, MultiArgMorph, SnapActions, isNil,
   ReporterSlotMorph, RingMorph, SyntaxElementMorph*/
// Extensions to the Snap blocks
MultiHintArgMorph.prototype = new MultiArgMorph();
MultiHintArgMorph.prototype.constructor = MultiHintArgMorph;
MultiHintArgMorph.uber = MultiArgMorph.prototype;

// MultiHintArgMorph preferences settings:

MultiHintArgMorph.prototype.executeOnSliderEdit = false;
function MultiHintArgMorph(
    hintText,
    labelTxt,
    min,
    eSpec,
    arrowColor,
    labelColor,
    shadowColor,
    shadowOffset,
    isTransparent
) {
    this.init(
        hintText,
        labelTxt,
        min,
        eSpec,
        arrowColor,
        labelColor,
        shadowColor,
        shadowOffset,
        isTransparent
    );
}

MultiHintArgMorph.prototype.init = function(
    hintText,
    labelTxt,
    min,
    eSpec,
    arrowColor,
    labelColor,
    shadowColor,
    shadowOffset,
    isTransparent
) {
    this.hintText = hintText || '';
    MultiHintArgMorph.uber.init.call(
        this,
        '%s',  // all multi hint args are strings
        labelTxt,
        min,
        eSpec,
        arrowColor,
        labelColor,
        shadowColor,
        shadowOffset,
        isTransparent
    );
};

MultiHintArgMorph.prototype.addInput = function () {
    var newPart = this.labelPart('%hint' + this.hintText),
        idx = this.children.length - 1;
    newPart.parent = this;
    this.children.splice(idx, 0, newPart);
    newPart.drawNew();
    this.fixLayout();
};


// I should refactor the MessageInputSlotMorph to a generic base class. This
// base class should be a dropdown which dynamically inserts input fields (w/
// hint text) after itself
StructInputSlotMorph.prototype = new InputSlotMorph();
StructInputSlotMorph.prototype.constructor = StructInputSlotMorph;
StructInputSlotMorph.uber = InputSlotMorph.prototype;

// StructInputSlotMorph preferences settings:

StructInputSlotMorph.prototype.executeOnSliderEdit = false;

function StructInputSlotMorph(
    value,
    isNumeric,
    choiceDict,
    fieldValues,
    isReadOnly
) {
    this.fields = [];
    this.fieldContent = [];
    this.getFieldNames = typeof fieldValues === 'string' ? this[fieldValues] : fieldValues || nop;

    InputSlotMorph.call(this, value, isNumeric, choiceDict, isReadOnly);
    this.isStatic = true;
}

StructInputSlotMorph.prototype.evaluate = function() {
    var myself = this;
    return [
        StructInputSlotMorph.uber.evaluate.call(myself),
        myself.fields
    ];
};

StructInputSlotMorph.prototype.setContents = function(name, values) {
    // Set the value for the dropdown
    InputSlotMorph.prototype.setContents.call(this, name);

    if (this.parent) {  // update fields
        var children = this.parent.children,
            myIndex = children.indexOf(this),
            currentFields = this.fields,
            i = currentFields.length + myIndex + 1,
            input = children[--i],
            removed = [],
            scripts = this.parentThatIsA(ScriptsMorph);

        // Remove the "i" fields after the current morph
        for (i = 0; i < this.fieldContent.length; i++) {
            input = this.fieldContent[i];
            removed.push(input);
            this.parent.removeChild(input);
        }
        this.fields = this.getFieldNames(name);

        if (scripts) {
            removed
                .filter(function(arg) {
                    return arg instanceof BlockMorph;
                })
                .forEach(scripts.add.bind(scripts));
        }

        // Create new struct fields
        values = values || [];
        this.fieldContent = [];
        for (i = 0; i < this.fields.length; i++) {
            this.fieldContent.push(this.updateField(this.fields[i], values[i]));
        }

        var inputs = this.parent.inputs();
        for (i = this.fields.length; i < values.length && i < inputs.length; i++) {
            inputs[i].setContents(values[i]);
        }
        this.fixLayout();
        this.drawNew();
        this.parent.cachedInputs = null;
        this.parent.fixLayout();
        this.parent.changed();
    }
};

StructInputSlotMorph.prototype.getFieldValue = function(fieldname, value) {
    // Input slot is empty or has a string
    if (!value || typeof value === 'string') {
        var result = new HintInputSlotMorph(value || '', fieldname);
        return result;
    }

    return value;  // The input slot is occupied by another block
};

StructInputSlotMorph.prototype.setDefaultFieldArg = function(index) {
    // Reset the field and return it
    var isStructField = index < this.fields.length,
        parentIndex,
        arg;

    if (isStructField) {

        parentIndex = this.parent.children.indexOf(this) + index + 1;

        arg = this.fieldContent[index] = this.getFieldValue(this.fields[index]);
        this.parent.children.splice(parentIndex, 1, arg);
        arg.parent = this.parent;
    }

    arg.drawNew();
    arg.fixLayout();
    arg.drawNew();

    this.parent.drawNew();
    this.parent.fixLayout();
    this.parent.drawNew();

    return arg;
};


StructInputSlotMorph.prototype.updateField = function(field, value) {
    // Create the input slot w/ greyed out text
    // Value is either:
    // + scripts
    // + blocks
    // + values
    // + colors
    // + undefined
    // + string

    // Add the fields at the correct place wrt the current morph
    var index = this.parent.children.indexOf(this) + this.fields.indexOf(field) + 1,
        result = this.getFieldValue(field, value);

    this.parent.children.splice(index, 0, result);
    result.parent = this.parent;

    return result;
};

RPCInputSlotMorph.prototype = new StructInputSlotMorph();
RPCInputSlotMorph.prototype.constructor = RPCInputSlotMorph;
RPCInputSlotMorph.uber = StructInputSlotMorph.prototype;

function RPCInputSlotMorph() {
    StructInputSlotMorph.call(
        this,
        null,
        false,
        'methodSignature',
        function(rpcMethod) {
            if (!this.fieldsFor) {
                this.methodSignature();
            }
            return this.fieldsFor[rpcMethod] || [];
        },
        true
    );
}

RPCInputSlotMorph.prototype.getRPCName = function () {
    var fields = this.parent.inputs(),
        field,
        i;

    // assume that the rpc is right before this input
    i = fields.indexOf(this);
    field = fields[i-1];

    if (field) {
        return field.evaluate();
    }
    return null;
};

RPCInputSlotMorph.prototype.methodSignature = function () {
    var actions,
        rpc,
        dict = {};

    rpc = this.getRPCName();
    if (rpc) {
        this.fieldsFor = JSON.parse(this.getURL('/rpc/' + rpc));

        actions = Object.keys(this.fieldsFor);
        for (var i = actions.length; i--;) {
            dict[actions[i]] = actions[i];
        }
    }
    return dict;
};

// HintInputSlotMorph //////////////////////////////////////////////
// I am an input slot with greyed out hint text when I am empty

HintInputSlotMorph.prototype = new InputSlotMorph();
HintInputSlotMorph.prototype.constructor = HintInputSlotMorph;
HintInputSlotMorph.uber = InputSlotMorph.prototype;

function HintInputSlotMorph(text, hint, isNumeric) {
    var self = this;

    this.hintText = hint;
    this.empty = true;
    InputSlotMorph.call(this, text, isNumeric);

    // If the StringMorph gets clicked on when empty, the hint text
    // should be "ghostly"
    this.contents().mouseDownLeft = function() {
        if (self.empty) {
            this.text = '';
        }
        StringMorph.prototype.mouseDownLeft.apply(this, arguments);
    };
}

HintInputSlotMorph.prototype.evaluate = function() {
    if (this.empty) {  // ignore grey text
        return this.isNumeric ? 0 : '';
    }
    return InputSlotMorph.prototype.evaluate.call(this);
};

HintInputSlotMorph.prototype.setContents = function(value) {
    var color = new Color(0, 0, 0),
        contents = this.contents();

    // If empty, set to the hint text
    InputSlotMorph.prototype.setContents.apply(this, arguments);
    this.empty = value === '';
    if (this.empty) {  // Set the contents to the hint text
        // Set the text to the hint text
        contents.text = this.hintText;
        color = new Color(100, 100, 100);
    }
    contents.color = color;
    contents.drawNew();
};

// Check if the given morph has been changed
HintInputSlotMorph.prototype.changed = function() {
    var txtMorph = this.contents();
    if (txtMorph) {
        this.empty = txtMorph.text === this.hintText;
    }
    return InputSlotMorph.prototype.changed.call(this);
};

// Adding struct support to replacing default inputs
SyntaxElementMorph.prototype.revertToDefaultInput = function (arg, noValues) {
    var idx = this.parts().indexOf(arg),
        inp = this.inputs().indexOf(arg),
        deflt = new InputSlotMorph();

    // Netsblox addition: start
    // Update idx for struct support
    var structs = this.parts().filter(function(part) {
            return part instanceof StructInputSlotMorph;
        }),
        specOffset = structs.reduce(function(offset, struct) {
            return offset + struct.fields.length;
        }, 0);

    idx = idx !== -1 ? idx - specOffset : idx;
    // Netsblox addition: end
    if (idx !== -1) {
        if (this instanceof BlockMorph) {
            deflt = this.labelPart(this.parseSpec(this.blockSpec)[idx]);
            if (deflt instanceof InputSlotMorph && this.definition) {
                deflt.setChoices.apply(
                    deflt,
                    this.definition.inputOptionsOfIdx(inp)
                );
                deflt.setContents(
                    this.definition.defaultValueOfInputIdx(inp)
                );
            }
        } else if (this instanceof MultiArgMorph) {
            deflt = this.labelPart(this.slotSpec);
        } else if (this instanceof ReporterSlotMorph) {
            deflt = this.emptySlot();
        }
    }

    // Try to set to the old value, first. If there is no old value,
    // then (potentially) try to set the default value
    var lastValue = SnapActions.getFieldValue(this, inp);
    if (lastValue !== undefined) {
        deflt.setContents(lastValue);
    } else if (!noValues) {  // set default value
        if (inp !== -1) {
            if (deflt instanceof MultiArgMorph) {
                deflt.setContents(this.defaults);
                deflt.defaults = this.defaults;
            } else if (!isNil(this.defaults[inp])) {
                deflt.setContents(this.defaults[inp]);
            }
        }
    }
    this.silentReplaceInput(arg, deflt);
    if (deflt instanceof MultiArgMorph) {
        deflt.refresh();
    } else if (deflt instanceof RingMorph) {
        deflt.fixBlockColor();
    }
    this.cachedInputs = null;
};

var addStructReplaceSupport = function(fn) {
    return function(arg) {
        var structInput,
            structInputIndex = -1,
            inputs = this.inputs(),
            inputIndex = inputs.indexOf(arg),
            relIndex;

        // Check if 'arg' follows a MessageInputSlotMorph (these are a special case)
        for (var i = inputs.length; i--;) {
            if (inputs[i] instanceof StructInputSlotMorph) {
                structInputIndex = i;
                structInput = inputs[i];
            }
        }

        if (structInput && structInputIndex < inputIndex &&
            structInput.fields.length >= inputIndex - structInputIndex) {

            relIndex = inputIndex - structInputIndex - 1;
            var defaultArg = structInput.setDefaultFieldArg(relIndex);
            this.silentReplaceInput(arg, defaultArg);
            this.cachedInputs = null;
        } else {
            fn.apply(this, arguments);
        }
    };
};

ReporterBlockMorph.prototype.revertToDefaultInput =
    addStructReplaceSupport(ReporterBlockMorph.prototype.revertToDefaultInput);

CommandBlockMorph.prototype.revertToDefaultInput =
    addStructReplaceSupport(CommandBlockMorph.prototype.revertToDefaultInput);
