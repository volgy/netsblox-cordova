/*globals nop, SnapCloud, Context, SpriteMorph, StageMorph, SnapActions,
  DialogBoxMorph, IDE_Morph, ProjectsMorph, isObject, NetsBloxSerializer,
  BlockMorph*/
// WebSocket Manager

var WebSocketManager = function (ide) {
    this.ide = ide;
    this.uuid = null;
    this.websocket = null;
    this.messages = [];
    this.processes = [];  // Queued processes to start
    this._protocol = window.location.protocol === 'https:' ?
        'wss:' : 'ws:';
    //this.url = this._protocol + '//' + window.location.host;
    this.url = 'wss://editor.netsblox.org';
    this._connectWebSocket();
    this._heartbeat();
    this.version = Date.now();

    this.errored = false;
    this.hasConnected = false;
    this.connected = false;
    this.serializer = new NetsBloxSerializer();
};

WebSocketManager.HEARTBEAT_INTERVAL = 55*1000;  // 55 seconds

WebSocketManager.MessageHandlers = {
    // Receive an assigned uuid
    'uuid': function(msg) {
        this.uuid = msg.body;
        this.onConnect();
    },

    // Game play message
    'message': function(msg) {
        var dstId = msg.dstId,
            messageType = msg.msgType,
            content = msg.content;

        // filter for gameplay
        if (dstId === this.ide.projectName || dstId === 'others in room' || dstId === 'everyone in room') {
            content = this.deserializeMessage(msg);
            this.onMessageReceived(messageType, content, 'role');
        }
    },

    'export-room': function(msg) {
        if (msg.action === 'export') {
            this.ide.exportRoom(msg.roles);
        } else if (msg.action === 'save') {
            this.ide.saveRoomLocal(msg.roles);
        }
    },

    // Update on the current roles at the given room
    'room-roles': function(msg) {
        this.ide.room.update(msg.owner,
            msg.name,
            msg.occupants
        );
    },

    'close-invite': function(msg) {
        if (this.ide.room.invitations[msg.id]) {
            this.ide.room.invitations[msg.id].destroy();
            delete this.ide.room.invitations[msg.id];
        }
    },

    // Receive an invite to join a room
    'room-invitation': function(msg) {
        this.ide.room.promptInvite(msg);
    },

    'collab-invitation': function(msg) {
        this.ide.promptCollabInvite(msg);
    },

    'project-closed': function() {
        var owner = this.ide.room.ownerId;
        this.ide.showMessage(owner + ' closed the room. ' +
            'You can ask to join again once ' + owner + ' opens the project again');
        this.ide.newProject();
    },

    'project-fork': function() {
        this.ide.showMessage('You have been evicted from the room.\nYou are now the owner.');
    },

    'project-request': function(msg) {
        var project = this.getSerializedProject();
        msg.type = 'project-response';
        msg.project = project;

        this.sendMessage(msg);
    },

    'rename-role': function(msg) {
        if (msg.roleId === this.ide.projectName) {  // role name and project name are the same
            this.ide.silentSetProjectName(msg.name);
        }
    },

    'notification': function(msg) {
        this.ide.showMessage(msg.message);
    },

    'share-msg-type': function(msg) {
        // only share with intended role
        if (this.ide.projectName === msg.roleId) {
            var myself = this,
                dialog = new DialogBoxMorph();
            // reject duplicates
            if (this.ide.stage.messageTypes.msgTypes[msg.name]) {
                this.ide.showMessage(msg.from + ' tried sending you message type \'' + msg.name + '\' when you already have it!', 2);
            } else {
                // Prepare dialog & prompt user
                var request =
                    msg.from + ' requested to send you a message type:\n\'' +
                    msg.name + '\' with ' +
                    msg.fields.length +
                    (msg.fields.length !== 1 ? ' fields.' : ' field.') + '\n' +
                    'Would you like to accept?';

                dialog.askYesNo('Message Share Request', request, myself.ide.root());

                // Accept the request
                dialog.ok = function() {
                    var ide = myself.ide.root().children[0].parentThatIsA(IDE_Morph);
                    SnapActions.addMessageType(msg.name, msg.fields)
                        .accept(function() {
                            // format fields
                            var fields = [];
                            for (var i = 0; i < msg.fields.length; i++) {
                                fields.push(' ' + '\'' + msg.fields[i] + '\'');
                            }

                            // format notification
                            var notification = 'Received message type \'' + msg.name + '\' with ' + msg.fields.length +
                                (msg.fields.length === 0 ? ' fields.' : (msg.fields.length === 1 ? ' field: ' + msg.fields : ' fields: ' + msg.fields));

                            // notify
                            this.destroy();
                            myself.ide.showMessage(notification, 2);

                            // refresh message palette
                            ide.room.parentThatIsA(ProjectsMorph).updateRoom();
                            if (ide && ide.currentTab === 'room') {
                                ide.spriteBar.tabBar.tabTo('room');
                            }
                        });
                    this.destroy();
                };
            }
        }
    }
};

WebSocketManager.prototype._connectWebSocket = function() {
    // Connect socket to the server
    var self = this,
        isReconnectAttempt = this.websocket !== null;

    // Don't connect if the already connected
    if (isReconnectAttempt) {
        if (this.websocket.readyState === this.websocket.OPEN) {
            return;
        } else if (this.websocket.readyState === this.websocket.CONNECTING) {
            // Check if successful in 500 ms
            setTimeout(self._connectWebSocket.bind(self), 500);
            return;
        }
    }

    this.websocket = new WebSocket(this.url);
    // Set up message firing queue
    this.websocket.onopen = function() {
        if (self.errored === true) {
            self.ide.showMessage((self.hasConnected ? 're' : '') + 'connected!', 2);
            self.errored = false;
        }
        self.hasConnected = true;
        self.connected = true;

        if (self.uuid) {
            self.sendMessage({type: 'set-uuid', body: self.uuid});
            self.onConnect();
        } else {
            self.sendMessage({type: 'request-uuid'});
        }

    };

    // Set up message events
    // Where should I set this up now?
    this.websocket.onmessage = function(rawMsg) {
        var msg = JSON.parse(rawMsg.data),
            type = msg.type;

        if (msg.namespace === 'netsblox') {
            if (WebSocketManager.MessageHandlers[type]) {
                WebSocketManager.MessageHandlers[type].call(self, msg);
            } else {
                console.error('Unknown message:', msg);
            }
        } else {
            SnapActions.onMessage(msg);
        }
    };

    this.websocket.onclose = function() {
        var errMsg;

        if (self.connected) {
            self.version = Date.now();
            self.connected = false;
        }

        if (!self.errored && Date.now() - self.version > 5000) {  // tried connecting for 5 seconds
            errMsg = self.hasConnected ?
                'Temporarily disconnected.\nSome network functionality may be ' +
                'nonfunctional.\nTrying to reconnect...' :

                'Could not fully connect to NetsBlox.\nPlease try refreshing ' +
                'your browser or try a different browser';

            self.ide.showMessage(errMsg);
            self.errored = true;
        }

        setTimeout(self._connectWebSocket.bind(self), 500);
    };
};

WebSocketManager.prototype.sendMessage = function(message) {
    var state = this.websocket.readyState;
    message.namespace = 'netsblox';
    message = this.serializeMessage(message);
    if (state === this.websocket.OPEN) {
        this.websocket.send(message);
    } else {
        this.messages.push(message);
    }
};

WebSocketManager.prototype.serializeMessage = function(message) {
    if (message.content) {
        var myself = this,
            fields = Object.keys(message.content),
            definitions = [],
            content;

        for (var i = fields.length; i--;) {
            content = message.content[fields[i]];
            if (isObject(content)) {
                if (content instanceof Context) {
                    content.receiver = null;
                    content.outerContext = null;
                    definitions = definitions.concat(this.getRequiredDefinitions(content.expression));
                }
                message.content[fields[i]] = this.serializer.serialize(content);
            }
        }

        // Attach the necessary definitions
        message.definitions = definitions.map(function(definition) {
            return myself.serializer.serialize(definition);
        }).reverse();
    }

    return JSON.stringify(message);
};

WebSocketManager.prototype.getRequiredDefinitions = function(block) {
    var myself = this,
        allDefinitions;

    if (!(block instanceof BlockMorph)) {
        return [];
    }

    allDefinitions = block.inputs().map(function(input) {
        return myself.getRequiredDefinitions(input);
    }).reduce(function(l1, l2) {
        return l1.concat(l2);
    }, []);

    if (block.definition) {
        allDefinitions.push(block.definition);
        allDefinitions = allDefinitions.concat(
            this.getRequiredDefinitions(block.definition.body.expression));
    }

    if (block.nextBlock && block.nextBlock()) {
        allDefinitions = allDefinitions.concat(this.getRequiredDefinitions(block.nextBlock()));
    }

    return allDefinitions;
};

WebSocketManager.prototype.deserializeMessage = function(message) {
    var myself = this,
        content = message.content,
        fields = Object.keys(content),
        definitions = message.definitions,
        value;

    // Load any provided block definitions first
    if (definitions) {
        definitions = definitions.map(function(definition) {
            return myself.serializer.loadCustomBlock(
                myself.serializer.parse(definition),
                true
            );
        });
        this.serializer.init();
        this.serializer.project.stage = new StageMorph();
        this.serializer.project.sprites = {};
        this.serializer.project.stage.globalBlocks = definitions;
    }

    for (var i = fields.length; i--;) {
        value = content[fields[i]];
        if (value[0] === '<') {
            try {
                content[fields[i]] = this.serializer.loadValue(this.serializer.parse(value));
            } catch(e) {  // must not have been XML
                console.error('Could not deserialize!', e);
            }
        }
    }
    return content;
};

WebSocketManager.prototype.onConnect = function() {
    if (SnapCloud.username) {  // Reauthenticate if needed
        var updateRoom = this.updateRoomInfo.bind(this);
        SnapCloud.reconnect(updateRoom, updateRoom);
    } else {
        SnapCloud.passiveLogin(this.ide);
        this.updateRoomInfo();
    }
    while (this.messages.length) {
        this.websocket.send(this.messages.shift());
    }
};

WebSocketManager.prototype.updateRoomInfo = function() {
    var owner = this.ide.room.ownerId,
        roleId = this.ide.projectName,
        roomName = this.ide.room.name || '__new_project__',
        msg = {
            type: 'create-room',
            room: roomName,
            role: roleId
        };

    if (owner) {
        msg.type = 'join-room';
        msg.owner = owner;
    }
    this.sendMessage(msg);
};

/**
 * Callback for receiving a websocket message.
 *
 * @param {String} message
 * @return {undefined}
 */
WebSocketManager.prototype.onMessageReceived = function (message, content, role) {
    var hats = [],
        context,
        idle = !this.processes.length,
        stage = this.ide.stage,
        block;

    content = content || [];
    if (message !== '') {
        stage.children.concat(stage).forEach(function (morph) {
            if (morph instanceof SpriteMorph || morph instanceof StageMorph) {
                hats = hats.concat(morph.allHatBlocksForSocket(message, role));  // FIXME
            }
        });

        for (var h = hats.length; h--;) {
            block = hats[h];
            // Initialize the variable frame with the message content for
            // receiveSocketMessage blocks
            context = null;
            if (block.selector === 'receiveSocketMessage') {
                // Create the network context
                context = new Context();
                context.variables.addVar('__message__', content);
            }

            // Find the process list for the given block
            this.addProcess({
                block: block,
                isThreadSafe: stage.isThreadSafe,
                context: context
            });
        }

        if (idle) {
            // This is done in a setTimeout to allow for some of the processes to accumulate
            // and not block the main UI thread. Otherwise, it would simply try to start the
            // last message each time (we are more efficient when we can batch it like this).
            setTimeout(this.startProcesses.bind(this), 50);
        }
    }
};

/**
 * Add a process to the queue of processes to run. These processes are sorted
 * by their top block
 *
 * @param process
 * @return {undefined}
 */
WebSocketManager.prototype.addProcess = function (process) {
    for (var i = 0; i < this.processes.length; i++) {
        if (process.block === this.processes[i][0].block) {
            this.processes[i].push(process);
            return;
        }
    }
    this.processes.push([process]);
};

/**
 * We will create a mutex on the network message/event listening blocks. That is,
 * network messages will not trigger a process until the currently running
 * process for the network event has terminated
 *
 * @return {undefined}
 */
WebSocketManager.prototype.startProcesses = function () {
    var process,
        block,
        stage = this.ide.stage,
        activeBlock;

    // Check each set of processes to see if the block is free
    for (var i = 0; i < this.processes.length; i++) {
        block = this.processes[i][0].block;
        activeBlock = !!stage.threads.findProcess(block);
        if (!activeBlock) {  // Check if the process can be added
            process = this.processes[i].shift();
            stage.threads.startProcess(
                process.block,
                process.isThreadSafe,
                null,
                null,
                null,
                true,
                process.context
            );
            if (!this.processes[i].length) {
                this.processes.splice(i,1);
                i--;
            }
        }
    }

    if (this.processes.length) {
        setTimeout(this.startProcesses.bind(this), 5);
    }
};

WebSocketManager.prototype.getSerializedProject = function() {
    var ide = this.ide,
        pdata,
        media;

    ide.serializer.isCollectingMedia = true;
    pdata = ide.serializer.serialize(ide.stage);
    media = ide.serializer.mediaXML(ide.projectName);
    ide.serializer.isCollectingMedia = false;
    ide.serializer.flushMedia();

    // check if serialized data can be parsed back again
    try {
        ide.serializer.parse(pdata);
    } catch (err) {
        ide.showMessage('Serialization of program data failed:\n' + err);
        throw new Error('Serialization of program data failed:\n' + err);
    }
    if (media !== null) {
        try {
            ide.serializer.parse(media);
        } catch (err) {
            ide.showMessage('Serialization of media failed:\n' + err);
            throw new Error('Serialization of media failed:\n' + err);
        }
    }
    ide.serializer.isCollectingMedia = false;
    ide.serializer.flushMedia();

    return {
        ProjectName: ide.projectName,
        SourceCode: pdata,
        Media: media,
        SourceSize: pdata.length,
        MediaSize: media ? media.length : 0,
        RoomName: this.ide.room.name
    };
};

WebSocketManager.prototype.destroy = function () {
    if (this.websocket.readyState === this.websocket.OPEN) {
        this._destroy();
    } else {
        this.websocket.onopen = this._destroy.bind(this);
    }
};

WebSocketManager.prototype._destroy = function () {
    this.websocket.onclose = nop;
    this.websocket.close();
};

// Heartbeat
WebSocketManager.prototype._heartbeat = function () {
    this.sendMessage({
        type: 'beat'
    });
    setTimeout(this._heartbeat.bind(this), WebSocketManager.HEARTBEAT_INTERVAL);
};
