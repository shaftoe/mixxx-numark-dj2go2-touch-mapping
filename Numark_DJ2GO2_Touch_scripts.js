// Declare the variable for your controller and assign it to an empty object
var DJ2GO2Touch = {};

// Mixxx calls this function on startup or when the controller
// is enabled in the Mixxx Preferences
DJ2GO2Touch.init = function () {
    // create an instance of your custom Deck object for each side of your controller
    DJ2GO2Touch.leftDeck = new DJ2GO2Touch.Deck([1], 0);
    DJ2GO2Touch.rightDeck = new DJ2GO2Touch.Deck([2], 1);
};

DJ2GO2Touch.shutdown = function () {
    // send whatever MIDI messages you need to turn off the lights of your controller
};

DJ2GO2Touch.browseEncoder = new components.Encoder({
    longPressTimer: 0,
    longPressTimeout: 250,
    previewSeekEnabled: false,
    previewSeekHappened: false,
    onKnobEvent: function(rotateValue) {
        if (rotateValue !== 0) {
            if (this.previewSeekEnabled) {
                var oldPos = engine.getValue('[PreviewDeck1]', 'playposition');
                var newPos = Math.max(0, oldPos + (0.05 * rotateValue));
                engine.setValue('[PreviewDeck1]', 'playposition', newPos);
            } else {
                engine.setValue('[Playlist]', 'SelectTrackKnob', rotateValue);
            }
        }
    },
    onButtonEvent: function(value) {
        if (value) {
            this.isLongPressed = false;
            this.longPressTimer = engine.beginTimer(
                this.longPressTimeout,
                function() { this.isLongPressed = true; },
                true
            );

            this.previewStarted = false;
            if (!engine.getValue('[PreviewDeck1]', 'play')) {
                engine.setValue('[PreviewDeck1]', 'LoadSelectedTrackAndPlay', 1);
                this.previewStarted = true;
            }
            // Track in PreviewDeck1 is playing, either the user
            // wants to stop the track or seek in it
            this.previewSeekEnabled = true;
            print(engine.getValue('[PreviewDeck1]', 'play'));
        } else {
            if (this.longPressTimer !== 0) {
                engine.stopTimer(this.longPressTimer);
                this.longPressTimer = 0;
            }
            
            if (!this.isLongPressed && !this.previewStarted && engine.getValue('[PreviewDeck1]', 'play')) {
                script.triggerControl('[PreviewDeck1]', 'stop');
            }
            this.previewSeekEnabled = false;
            this.previewStarted = false;
        }
    },
    input: function(channel, control, value, status, _group) {
        switch (status) {
        case 0xBF: // Rotate.
            var rotateValue = (value === 127) ? -1 : ((value === 1) ? 1 : 0);
            this.onKnobEvent(rotateValue);
            break;
        case 0x9F: // Push.
            this.onButtonEvent(value);
        }
    }
});

DJ2GO2Touch.masterGain = new components.Pot({
    midi: [0xBF, 0x0A],
    group: '[Master]',
    key: 'gain'
});

DJ2GO2Touch.cueGain = new components.Pot({
    midi: [0xBF, 0x0C],
    group: '[Master]',
    key: 'headGain'
});

DJ2GO2Touch.crossfader = new components.Pot({
    midi: [0xBF, 0x08],
    group: '[Master]',
    key: 'crossfader'
});

// implement a constructor for a custom Deck object specific to your controller
DJ2GO2Touch.Deck = function (deckNumbers, midiChannel) {
    // Call the generic Deck constructor to setup the currentDeck and deckNumbers properties,
    // using Function.prototype.call to assign the custom Deck being constructed
    // to 'this' in the context of the generic components.Deck constructor
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/call
    components.Deck.call(this, deckNumbers);

    this.playButton = new components.PlayButton([0x90 + midiChannel, 0x00]);
    this.cueButton = new components.CueButton([0x90 + midiChannel, 0x01]);
    this.syncButton = new components.SyncButton([0x90 + midiChannel, 0x02]);
    
    this.pflButton = new components.Button({
        midi: [0x90 + midiChannel, 0x1B],
        key: 'pfl'
    });
    
    this.loadButton = new components.Button({
        midi: [0x9F, 0x02 + midiChannel],
        key: 'LoadSelectedTrack',
        input: function(channel, control, value, status, _group) {
            this.send(this.isPress(channel, control, value, status) ? this.on : this.off);
            components.Button.prototype.input.apply(this, arguments);
        }
    });
    
    this.preGain = new components.Pot({
        midi: [0xB0 + midiChannel, 0x16],
        group: '[QuickEffectRack1_' + this.currentDeck + ']',
        key: 'super1'
    });
    
    engine.setValue(this.currentDeck, 'rate_dir', -1);
    this.tempoFader = new components.Pot({
        group: '[Channel' + deckNumbers + ']',
        midi: [0xB0 + midiChannel, 0x09],
        inKey: 'rate',
        inSetParameter: components.Pot.prototype.inSetParameter,
        connect: function() {
            engine.softTakeover(this.group, 'rate', true);
            components.Pot.prototype.connect.apply(this, arguments);
        }
    });

    this.hotcueButtons = [];
    for (var i = 1; i <= 4; i++) {
        this.hotcueButtons[i] = new components.HotcueButton({
            midi: [0x94, 0x01 + i],
            number: i,
        });
    }
    
    this.beatloopButtons = [];
    for (var i = 1; i <= 4; i++) {
        this.beatloopButtons[i] = new components.Button({
            midi: [0x94, 0x11 + i],
            number: i,
        });
    }

    this.wheelTouch = function(channel, control, value, _status, _group) {
        if ((_status & 0xF0) === 0x90) {
            var alpha = 1.0/8;
            var beta = alpha/32;
            engine.scratchEnable(script.deckFromGroup(this.currentDeck), 236, 33+1/3, alpha, beta);
        } else {    // If button up
            engine.scratchDisable(script.deckFromGroup(this.currentDeck));
        }
    };

    this.wheelTurn = function(channel, control, value, _status, _group) {
        // When the jog wheel is turned in counter-clockwise direction, value is
        // greater than 64 (= 0x40). If it's turned in clockwise
        // direction, the value is smaller than 64.
        var newValue = value > 64 ? (value - 128) : value;
        var deck = script.deckFromGroup(this.currentDeck);
        if (engine.isScratching(deck)) {
            engine.scratchTick(deck, newValue); // Scratch!
        } else {
            engine.setValue(this.currentDeck, 'jog', newValue); // Pitch bend
        }

        this.LoopToggleButton = new components.LoopToggleButton([0x94 + midiChannel, 0x23]);

        this.loopIn = new components.Button({
            midi: [0x94 + midiChannel, 0x21],
            key: 'loop_in',
        });

        this.loopOut = new components.Button({
            midi: [0x94 + midiChannel, 0x22],
            key: 'loop_out',
        });
    };

    // Set the group properties of the above Components and connect their output callback functions
    // Without this, the group property for each Component would have to be specified to its
    // constructor.
    this.reconnectComponents(function (c) {
        if (c.group === undefined) {
            // 'this' inside a function passed to reconnectComponents refers to the ComponentContainer
            // so 'this' refers to the custom Deck object being constructed
            c.group = this.currentDeck;
        }
    });
    // when called with JavaScript's 'new' keyword, a constructor function
    // implicitly returns 'this'
};

// give your custom Deck all the methods of the generic Deck in the Components library
DJ2GO2Touch.Deck.prototype = new components.Deck();