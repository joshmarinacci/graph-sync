const test = require('tape')
const Sync = require('./sync.js')
const {ObjectSyncProtocol, HistoryView, DocGraph, CommandGenerator,
    SET_PROPERTY, CREATE_OBJECT, CREATE_PROPERTY, DELETE_PROPERTY, DELETE_OBJECT,
    CREATE_ARRAY, INSERT_ELEMENT, DELETE_ELEMENT,
} = Sync



// create object A as child of root with property x = 100
test('basic',t => {
    const sync = new DocGraph()
    const root = sync.createObject()
    sync.createProperty(root,'id','root')


    const A = sync.createObject()
    sync.createProperty(A,'id','A')
    sync.createProperty(A,'x',100)

    const B = sync.createObject()
    sync.createProperty(B,'id','B')

    const R = sync.createArray()
    sync.setProperty(root,'children',R)
    sync.insertElement(R,0,A)
    sync.insertElement(R,1,B)

    const graph1 = sync.dumpGraph()
    const ans = {
        root: {id: 'root', children: R},
        A: {id: 'A',x:100},
        B: {id: 'B'},
    }
    ans[R] = [A,B]
    t.deepEquals(graph1, ans)
    t.equals(sync.getArrayLength(R),2)


    sync.removeElement(R,1)
    ans[R] = [A]
    t.deepEquals(sync.dumpGraph(),ans)
    t.equals(sync.getArrayLength(R),1)

    t.end()
})

test('array access',t => {
    const sync = new DocGraph()
    const R = sync.createArray()
    const A = sync.createObject()
    const B = sync.createObject()
    sync.insertElement(R,0,A)
    sync.insertElement(R,1,B)

    // console.log('graph',sync.dumpGraph()[R])
    t.deepEquals(sync.dumpGraph()[R],[A,B])
    t.equals(sync.getElementAt(R,0),A)
    t.equals(sync.getElementAt(R,1),B)
    t.equals(sync.getArrayLength(R),2)

    //delete A
    //confirm contents and length
    sync.removeElement(R,0)
    t.equals(sync.getArrayLength(R),1)
    t.equals(sync.getElementAt(R,0),B)
    t.deepEquals(sync.dumpGraph()[R],[B])
    t.end()
})


// create object A with property x = 100
 // set x to 200
 // dump the history. shows create object, create prop, set prop

test('history', t => {
    const sync = new DocGraph()
    const history = new HistoryView(sync)
    const A = sync.createObject()
    sync.createProperty(A,'id','A')
    sync.createProperty(A,'x',100)
    sync.setProperty(A,'x',200)

    const dump = history.dump().map((e)=>{
        delete e.host
        delete e.timestamp
        return e
    })
    t.deepEquals(dump,[
        { type:CREATE_OBJECT},
        { type:CREATE_PROPERTY,name:'id',value:'A'},
        { type:CREATE_PROPERTY,name:'x',value:100},
        { type:SET_PROPERTY,name:'x',value:200},
    ])

    t.end()
})


// user A create object R with R.x = 100
// sync
// user B sets R.x to 200
// sync
// user A can see R.x = 200

test('sync', t => {
    const A = new DocGraph({host:'A'})
    const B = new DocGraph({host:'B'})

    A.onChange(e => B.process(e))
    B.onChange(e => A.process(e))

    const aR1 = A.createObject()
    A.createProperty(aR1,'id','R')
    A.createProperty(aR1,'x',100)

    t.deepEquals(A.dumpGraph(), { R: {id: 'R',x:100} })
    t.deepEquals(B.dumpGraph(), { R: {id: 'R',x:100} })


    const bR1 = B.getObjectByProperty('id','R')
    B.setProperty(bR1,'x',200)

    t.deepEquals(A.dumpGraph(), { R: {id:'R',x:200}})
    t.deepEquals(B.dumpGraph(), { R: {id:'R',x:200}})


    const aR2 = A.getObjectByProperty('id','R')
    t.equal(A.getPropertyValue(aR2,'x'),200)


    A.deleteProperty(aR2,'x')
    t.equal(A.hasPropertyValue(aR2,'x'),false)
    t.equal(B.hasPropertyValue(aR2,'x'),false)

    A.deleteObject(aR2)
    t.deepEqual(A.dumpGraph(),{})
    t.deepEqual(B.dumpGraph(),{})

    t.end()
})



// create object R with R.x = 100
// set R.x = 200
// check undo queue
// undo it
// check
// redo it
// check


// undo queue has a current position.
// actually undoing an operation requires adding an operation to it's inverse
// this should not affect the current position
// adding a new operation, not part of the undo queue, chops the history and moves position to the end
//
// insert:   a                  0
// insert:   a,b                1
// insert:   a,b,c              2
// undo:     a,b,c,C            1
// undo:     a,b,c,C,B          0
// insert:   a,b,c,C,B,d        5
//


function short(op) {
    let str = op.type + ' '
    if(op.name) {
        str += op.name + "=" + op.value
    }
    return str
}
test('undo',t => {
    class UndoQueue {
        constructor(graph) {
            this.graph = graph
            this.history = []
            this.current = -1
            this.commands = new CommandGenerator(graph)
        }

        submit(op) {
            // console.log("appending",short(op))
            this.history.push(op)
            this.current = this.history.length-1
        }
        canUndo() {
            return this.current > 0
        }
        canRedo() {
            return this.current < this.history.length-1
        }
        undo() {
            const last = this.history[this.current]
            this.current--
            // console.log("undoing",short(last))
            if(last.type === SET_PROPERTY) {
                const op = this.commands.setProperty(last.object,last.name,last.prevValue)
                this.graph.process(op)
                return
            }
            if(last.type === CREATE_PROPERTY) {
                const op = this.commands.deleteProperty(last.object,last.name)
                this.graph.process(op)
                return
            }
            if(last.type === CREATE_OBJECT) {
                const op = this.commands.deleteObject(last.id)
                this.graph.process(op)
                return
            }
            if(last.type === INSERT_ELEMENT) {
                const op = this.commands.removeElementByEntryId(last.array,last.entryid)
                this.graph.process(op)
                return
            }
            throw new Error(`undo for type not supported: ${last.type}`)
        }
        redo() {
            this.current++
            const last = this.history[this.current]
            // console.log("redoin",this.current,last.type,last.name,'=',last.value)
            if(last.type === SET_PROPERTY) {
                const op = this.commands.setProperty(last.object,last.name,last.value)
                this.graph.process(op)
                return
            }
            if(last.type === CREATE_PROPERTY) {
                const op = {
                    type: last.type,
                    host: last.host,
                    timestamp: Date.now(),
                    object: last.object,
                    name: last.name,
                    value: last.value
                }
                this.graph.process(op)
                return
            }
            if(last.type === CREATE_OBJECT) {
                const op = this.commands.createObject()
                op.id = last.id
                this.graph.process(op)
                return
            }
            if(last.type === INSERT_ELEMENT) {
                // console.log("redoing",last)
                //TODO: this should use a real targetid instead of null
                const op = this.commands.insertAfter(last.array,null,last.value)
                this.graph.process(op)
                return
            }
            throw new Error(`redo for type not supported: ${last.type}`)
        }

        dump() {
            return this.history.map((op,i) => i+" " + op.type + " " + op.name + " => " + op.value)
        }
    }

    const graph = new ObjectSyncProtocol({host:'doc'})
    const doc = new CommandGenerator(graph,{host:'doc'})
    const undoqueue = new UndoQueue(graph)

    //create R
    const cmd = doc.createObject()
    graph.process(cmd)
    undoqueue.submit(cmd)
    t.false(undoqueue.canUndo())
    const R = cmd.id
    //X <= 100
    const cmd2 = doc.createProperty(R,'x',100)
    graph.process(cmd2)
    undoqueue.submit(cmd2)
    //X <= 200
    const cmd3 = doc.setProperty(R,'x',200)
    cmd3.prevValue = 100
    graph.process(cmd3)
    undoqueue.submit(cmd3)
    t.equals(graph.getPropertyValue(R,'x'),200)
    t.true(undoqueue.canUndo())
    t.false(undoqueue.canRedo())


    undoqueue.undo()
    t.true(undoqueue.canUndo())
    t.true(undoqueue.canRedo())
    t.equals(graph.getPropertyValue(R,'x'),100)

    undoqueue.redo()
    t.true(undoqueue.canUndo())
    t.false(undoqueue.canRedo())
    t.equals(graph.getPropertyValue(R,'x'),200)
    t.true(graph.hasPropertyValue(R,'x'))
    t.true(graph.hasObject(R))


    undoqueue.undo() //undo 200
    undoqueue.undo() //undo 100, create X
    t.false(graph.hasPropertyValue(R,'x'))
    undoqueue.undo() //undo create R
    t.false(graph.hasObject(R))
    t.false(undoqueue.canUndo())
    t.true(undoqueue.canRedo())
    undoqueue.redo() //redo create R
    t.true(graph.hasObject(R))

    //create y
    const cmd4 = doc.createProperty(R,'y',200)
    graph.process(cmd4)
    undoqueue.submit(cmd4)
    t.true(undoqueue.canUndo())
    t.false(undoqueue.canRedo()) //no more redo. the redo for x is gone now
    t.false(graph.hasPropertyValue(R,'x'))
    t.true(graph.hasPropertyValue(R,'y'))



    //create array CHILDREN
    const cmd10 = doc.createArray()
    graph.process(cmd10)
    undoqueue.submit(cmd10)
    const C = cmd10.id
    t.equals(graph.getArrayLength(C),0)

    //insert R into children
    const cmd11 = doc.insertElement(C,0,R)
    graph.process(cmd11)
    undoqueue.submit(cmd11)

    //create T with y = 300
    const cmd12 = doc.createObject()
    graph.process(cmd12)
    undoqueue.submit(cmd12)
    const T = cmd12.id
    const cmd13 = doc.createProperty(T,'y',300)
    graph.process(cmd13)
    undoqueue.submit(cmd13)

    //insert T into children before R
    const cmd14 = doc.insertElement(C,0,T)
    graph.process(cmd14)
    undoqueue.submit(cmd14)

    //validate children
    t.equals(graph.getArrayLength(C),2)
    //undo insert T
    undoqueue.undo()
    //validate children
    t.equals(graph.getArrayLength(C),1)
    //undo create T.y
    undoqueue.undo()
    t.false(graph.hasPropertyValue(T,'y'))
    t.equals(graph.getArrayLength(C),1)
    //undo create
    t.true(graph.hasObject(T))
    undoqueue.undo()
    t.false(graph.hasObject(T))

    //undo insert R
    undoqueue.undo()
    //validate children
    t.equals(graph.getArrayLength(C),0)
    //redo twice
    undoqueue.redo()
    t.equals(graph.getArrayLength(C),1)
    undoqueue.redo()
    //validate children again
    t.equals(graph.getArrayLength(C),1)
    undoqueue.redo()
    undoqueue.redo()
    t.equals(graph.getArrayLength(C),2)
    // console.log(graph.dumpGraph())

    t.end()
})

/*
 * tree B follows changes to tree A. Add, set, delete some objects. Confirm tree B is still valid.
 */

test('jsonview',t => {
    class JSONView {
        constructor(graph) {
            this.graph = graph
            graph.onChange((e)=>{
            })
        }

        getJSONViewById(id) {
            const root = this.graph.getObjectByProperty('id',id)
            return this.getJSONViewByRealId(root)
        }
        getJSONViewByRealId(id) {
            const props = this.graph.getPropertiesForObject(id)
            const rootObj = {}
            props.forEach(name => {
                rootObj[name] = this.graph.getPropertyValue(id,name)
                if(name === 'children') {
                    rootObj.children = rootObj[name].map((objid)=>{
                        return this.getJSONViewByRealId(objid)
                    })
                }
            })

            return rootObj
        }
    }

    const sync = new DocGraph({host:'json'})
    const jsonview = new JSONView(sync)

    const O1 = sync.createObject()
    sync.createProperty(O1,'id','O1')
    sync.createProperty(O1,'x',100)
    sync.setProperty(O1,'x',200)

    const root = sync.createObject()
    sync.createProperty(root,'id','ROOT')
    sync.createProperty(root,'x',300)
    sync.createProperty(root,'children',[O1])



    t.deepEquals(
        jsonview.getJSONViewById('ROOT'),
        {
            id:'ROOT',
            x:300,
            children:[
                {
                    id:'O1',
                    x:200
                }
            ]
        }
    )

    const O2 = sync.createObject()
    sync.createProperty(O2,'id','O2')
    sync.createProperty(O2,'x',400)
    sync.setProperty(root,'children',[O1,O2])



    t.deepEquals(
        jsonview.getJSONViewById('ROOT'),
        {
            id:'ROOT',
            x:300,
            children:[
                {
                    id:'O1',
                    x:200
                },
                {
                    id:'O2',
                    x:400
                }
            ]
        }
    )

    sync.deleteObject(O1)
    sync.setProperty(root,'children',[O2])

    t.deepEquals(
        jsonview.getJSONViewById('ROOT'),
        {
            id:'ROOT',
            x:300,
            children:[
                {
                    id:'O2',
                    x:400
                }
            ]
        }
    )

    t.end()
})


/*
* coalesce a set of changes into a single ‘transaction’
* which can then be submitted as a batch
 */

test('coalesce',t => {
    class Throttle {
        constructor(graph) {
            this.graph = graph
            this.paused = false
            this.buffer = []
            this.commands = new CommandGenerator(graph)
        }
        createProperty(objid, propname, value) {
            if(!this.paused) {
                return this.graph.createProperty(objid,propname,value)
            }
        }
        createObject() {
            return this.graph.process(this.commands.createObject())
        }
        setProperty(objid, propname, propvalue) {
            if(this.paused) {
                this.buffer.push({type:SET_PROPERTY,object:objid, name:propname, value:propvalue})
            } else {
                this.graph.process(this.commands.setProperty(objid,propname,propvalue))
            }
        }

        pause() {
            console.log("pausing")
            this.paused = true
        }

        unpause() {
            const b = {}
            this.buffer.forEach(e => {
                if(e.type === SET_PROPERTY) {
                    if(!b[e.object]) b[e.object] = {}
                    b[e.object][e.name] = e.value
                }
            })
            Object.keys(b).forEach((okey) =>{
                Object.keys(b[okey]).forEach(name=>{
                    const op = this.commands.setProperty(okey,name,b[okey][name])
                    this.graph.process(op)
                    // this.graph.setProperty(okey,name,b[okey][name])
                })
            })
            this.paused = false
            this.buffer = []
        }
    }

    const sync = new DocGraph()
    const history = []
    sync.onChange(e => history.push(e))

    const throttle = new Throttle(sync)

    const A = throttle.createObject()
    throttle.createProperty(A,'x',100)
    throttle.pause()
    throttle.setProperty(A,'x',101)
    throttle.setProperty(A,'x',102)
    throttle.setProperty(A,'x',103)
    console.log("unpausing")
    throttle.unpause()

    history.forEach(h=>{
        delete h.host
        delete h.timestamp
        delete h.uuid
        delete h.seq
    })
    t.deepEquals(history,
        [
            {type:CREATE_OBJECT, id:A},
            {type:CREATE_PROPERTY,object:A, name:'x',value:100},
            {type:SET_PROPERTY,object:A, name:'x',value:103}
        ]
    )
    t.end()
})

/*
 * record a sequence of changes while disconnected.
 * Reconnect and sync without conflicts.
 * Confirm that the final tree snapshot is correct.
 */
/*
test('disconnected',t => {
    function follow(X,Y) {
        X.onChange(e => {
            if(e.type === CREATE_OBJECT) Y.createObject(e.id)
            if(e.type === CREATE_PROPERTY) Y.createProperty(e.object, e.name, e.value)
            if(e.type === SET_PROPERTY) Y.setProperty(e.object, e.name, e.value)
        })
    }

    class DisconnectableSync extends ObjectSyncProtocol {
        constructor(graph) {
            super()
            this.connected = true
            this.buffer = []
        }
        disconnect() {
            this.connected = false
        }
        connect() {
            this.connected = true
            this.buffer.forEach(e=>this.fire(e))
            this.buffer = []
        }

        fire(event) {
            if(this.connected) {
                super.fire(event);
            } else {
                this.buffer.push(event)
            }
        }
    }


    const Server = new ObjectSyncProtocol()
    const A = new DisconnectableSync()
    const B = new ObjectSyncProtocol()
    follow(A,Server)
    follow(B,Server)
    follow(Server,A)
    follow(Server,B)


    const R = A.createObject()
    A.createProperty(R,'x',1)

    // all sides have the same value
    t.equal(A.getPropertyValue(R,'x'),1)
    t.equal(Server.getPropertyValue(R,'x'),1)
    t.equal(B.getPropertyValue(R,'x'),1)

    //disconnect A
    A.disconnect()
    A.createProperty(R,'y',20)
    A.setProperty(R,'x',2)

    // sides have different values
    t.equal(A.getPropertyValue(R,'x'),2)
    t.equal(Server.getPropertyValue(R,'x'),1)
    t.equal(B.getPropertyValue(R,'x'),1)

    t.equal(A.getPropertyValue(R,'y'),20)
    t.equal(Server.hasPropertyValue(R,'y'),false)
    t.equal(B.hasPropertyValue(R,'y'),false)

    //dump the local storage


    A.connect()

    // all sides have the same value
    t.equal(A.getPropertyValue(R,'x'),2)
    t.equal(Server.getPropertyValue(R,'x'),2)
    t.equal(B.getPropertyValue(R,'x'),2)

    // all sides have the same value
    t.equal(A.getPropertyValue(R,'y'),20)
    t.equal(Server.getPropertyValue(R,'y'),20)
    t.equal(B.getPropertyValue(R,'y'),20)
    t.end()
})
*/

// set property on a deleted object. Confirm that the final tree snapshot is correct.
test('invalid property setting',t => {
    const sync = new DocGraph()

    const R = sync.createObject()
    sync.createProperty(R,'id','R')
    sync.createProperty(R,'x',100)
    sync.setProperty(R,'x',200)
    t.deepEquals(sync.dumpGraph(),{
        R: {
            id:'R',
            x:200
        }
    })
    sync.deleteObject(R)
    sync.setProperty(R,'x',300)
    t.deepEquals(sync.dumpGraph(),{})
    t.end()
})

// create tree, sync new tree from the original by replaying history
test('tree clone',t=>{
    const sync = new DocGraph()
    const R = sync.createObject()
    sync.createProperty(R,'id','R')
    sync.createProperty(R,'x',100)
    sync.setProperty(R,'x',200)

    t.deepEquals(sync.dumpGraph(),{ R: { id:'R', x:200 }})
    t.equals(sync.graph.waitBuffer.length,0)

    const sync2 = new DocGraph()
    //play back history to load it up
    sync.getHistory().forEach(op => sync2.process(op))
    t.deepEquals(sync2.dumpGraph(),{ R: { id:'R', x:200 }})
    t.equals(sync2.graph.waitBuffer.length,0)

    //play back history again, confirm that it rejects the changes since it already has them
    sync.getHistory().forEach(op => sync2.process(op))
    t.deepEquals(sync2.dumpGraph(),{ R: { id:'R', x:200 }})
    t.equals(sync2.graph.waitBuffer.length,0)

    const sync3 = new DocGraph()
    //add the op to create R
    sync3.process(sync.graph.historyBuffer[0])
    //sync in the rest of the history
    sync.getHistory().forEach(op => sync3.process(op))
    t.deepEquals(sync3.dumpGraph(),{ R: { id:'R', x:200 }})
    t.equals(sync3.graph.waitBuffer.length,0)

    t.end()
})

test('detect invalid operation',t => {
    const A = new DocGraph()
    const R = A.createObject()
    //generate an invalid operation
    const op = { type: CREATE_PROPERTY, object: R, name:'name', value:'foo', seq:-1}
    t.true(A.graph.isValidOperation(op))
    op.object++
    t.false(A.graph.isValidOperation(op))
    t.end()
})


test('out of order, invalid object',t => {
    const history = []
    const A = new DocGraph()
    A.onChange(e => history.push(e))

    const R = A.createObject()
    A.createProperty(R,'name','foo')
    t.equals(A.getPropertyValue(R,'name'),'foo')

    const B = new DocGraph()
    history.forEach(e => B.process(e))
    t.equals(B.getPropertyValue(R,'name'),'foo')

    //now mess up the history. swap the two entries
    history.reverse()
    const C = new DocGraph()
    t.false(C.graph.isValidOperation(history[0]))
    history.forEach(e => C.process(e))
    t.equals(C.getPropertyValue(R,'name'),'foo')

    t.end()
})


//create array, create object, insert object into array
test('array object causality',t => {
    const history = []
    const A = new DocGraph({host:'A'})
    A.onChange(e => history.push(e))

    const S = A.createArray()
    const R = A.createObject()
    A.insertElement(S,0,R)
    t.equals(A.getArrayLength(S),1)

    const B = new DocGraph({host:'B'})
    history.forEach(e => B.process(e))
    t.equals(A.getArrayLength(S),1)

    //now mess up the history. swap the two entries
    history.reverse()
    const C = new DocGraph({host:'C'})
    history.forEach(e => C.process(e))
    // console.log(C.graph)
    t.equals(C.getArrayLength(S),1)
    t.end()

})





//        set property to 5, set property to 4 before the 5 setter, but received later. resolve with timestamp.
test('out of order, two property sets, last one should win',t => {
    return t.end()
    const history = []
    const A = new DocGraph()
    A.onChange(e => history.push(e))

    const R = A.createObject()
    A.createProperty(R,'name','name')
    A.setProperty(R,'name','foo')
    A.setProperty(R,'name','bar')
    t.equals(A.getPropertyValue(R,'name'),'bar')
    t.equals(history.length,4)


    const B = new DocGraph()
    history.forEach(e => B.process(e))
    t.equals(B.getPropertyValue(R,'name'),'bar')

    //now mess up the history. swap the last two entries
    const op1 = history[2]
    const op2 = history[3]
    history[2] = op2
    history[3] = op1
    const C = new DocGraph()
    history.forEach(e => C.process(e))
    t.equals(B.getPropertyValue(R,'name'),'bar')
    t.end()
})

//multiple operations come in out of order, one that can never be resolved. indicate it stays in the wait queue forever
test('completely unresolved operation',t => {
    return t.end()
})

//    sync receives external operation and applies it but doesn't rebroadcast it
test('dont recurse 1',t => {
    return t.end()
    const A = new DocGraph({host:'A'})
    const B = new DocGraph({host:'B'})
    const netA = new FakeNetworkRelay(A)
    const netB = new FakeNetworkRelay(B)

    const R = A.createObject()
    A.setPropertyValue(R,'name','foo')
    t.equals(A.getPropertyValue(R,'name'),'foo')
    t.equals(B.getPropertyValue(R,'name'),'foo')
    /*
    A creates event
    A applies event locally
    A sends event to network
    network forwards event to B
    B applies event locally
    B fires event
    network does not forward event back to A
     */
})

//     sync receives external operation on network from self, don't apply it
test('dont recurse 2',t => {
    return t.end()
})



/*
    A creates array with two objects in it, R & S
    B connects to A and gets full history
    A & B disconnect
    A adds object and inserts into the array after the first element, T
    B adds object and inserts into the array after the first element, U
    A & B connect and sync
    Both show array of R U T S.
    conflict is resolved by B having a slightly later timestamp than A
 */
test('array conflict resolution',t=>{
    return t.end()
    const Ahistory = []
    const Bhistory = []

    const A = new ObjectSyncProtocol()
    A.id = 'A'
    A.onChange((e)=> {
        Ahistory.push({event:e})
    })
    const R = A.createObject()
    A.setProperty(R,'id','R')
    const S = A.createObject()
    A.setProperty(S,'id','S')
    const arr = A.createArray('arr')
    A.insertElement(arr,0,R)
    A.insertElement(arr,1,S)

    t.deepEqual(A.dumpGraph(),{
        R: {id:'R'},
        S: {id:'S'},
        arr:[R,S]
    })

    const B = new ObjectSyncProtocol()
    B.id = 'B'
    B.onChange((e)=> {
        Bhistory.push({event:e})
    })
    function updateFromA(from,to) {
        Ahistory.forEach((e)=> performEvent(e.event,to))
    }
    updateFromA(A,B)


    t.deepEqual(B.dumpGraph(),{
        R: {id:'R'},
        S: {id:'S'},
        arr:[R,S]
    })

    function clearHistory(hist) {
        hist.splice(0,hist.length)
    }
    clearHistory(Ahistory)
    clearHistory(Bhistory)


    //disconnect A and B
    const T = A.createObject()
    A.setProperty(T,'id','T')
    A.insertElement(arr,1,T)

    const U = B.createObject()
    B.setProperty(U,'id','U')
    B.insertElement(arr,1,U)

    function updateFromB(from,to) {
        Bhistory.forEach((e)=> performEvent(e.event,to))
    }
    updateFromB(B,A)
    clearHistory(Bhistory)
    updateFromA(A,B)
    clearHistory(Ahistory)


    t.deepEqual(A.dumpGraph().arr, B.dumpGraph().arr)

    //remove the second element of the array, U
    t.equal(A.getArrayLength(arr),4)
    A.removeElement(arr,1)
    t.equal(A.getArrayLength(arr),3)

    //insert V at start of the array
    const V = B.createObject()
    B.setProperty(V,'id','V')
    B.insertElement(arr,1, V)
    updateFromB(B,A)

    t.deepEqual(A.dumpGraph().arr,[R,V,T,S])

    t.end()
})



function toObject(doc,id) {
    const obj = {}
    doc.getPropertiesForObject(id).forEach(key => {
        obj[key] = doc.getPropertyValue(id,key)
    })
    return obj
}

function toArray(doc,arrid) {
    const arr = []
    const len = doc.getArrayLength(arrid)
    for(let i=0; i<len; i++) {
        const id = doc.getElementAt(arrid,i)
        arr[i] = toObject(doc,id)
    }
    // console.log("make array",arr)
    return arr
}

function makeStandardArrayTest(doc) {
    function obj(name) {
        const o = doc.createObject()
        doc.createProperty(o,'name',name)
        return o
    }
    const R = doc.createArray()
    const X = obj('X')
    doc.insertElement(R,0,X)
    const Y = obj('Y')
    doc.insertElement(R,1,Y)
    const Z = obj('Z')
    doc.insertElement(R,2,Z)
    // console.log(doc.graph.objs)
    // console.log(toArray(doc,R))
    return R
}

test('delete element',(t) =>{
    const doc = new DocGraph({host:'A'})
    const R = makeStandardArrayTest(doc)
    t.equal(doc.getArrayLength(R),3)
    const elem = doc.getElementAt(R,0)
    doc.removeElement(R,0)
    t.equal(toArray(doc,R).map(e => e.name).join(""),'YZ')
    t.end()
})


test('move element to front',t=>{
    const doc = new DocGraph({host:'A'})
    const R = makeStandardArrayTest(doc)

    const CMD = new CommandGenerator(doc)
    const op1 = CMD.removeElement(R,2)
    const Z = doc.process(op1)
    t.equal(toObject(doc,Z).name,'Z')
    const op2 = CMD.insertAfter(R,null,Z)
    doc.process(op2)
    t.equal(toArray(doc,R,1).map(e => e.name).join(""),'ZXY')
    t.end()
})

test('move element to back',t => {
    const doc = new DocGraph({host:'A'})
    const R = makeStandardArrayTest(doc)
    const X = doc.getElementAt(R,0)
    const Z = doc.getElementAt(R,2)
    doc.removeElement(R,0)
    doc.insertAfter(R,Z,X)
    t.equal(toArray(doc,R).map(e => e.name).join(""),'YZX')
    t.end()
})
test('copy element to front',t => {
    const doc = new DocGraph({host:'A'})
    const R = makeStandardArrayTest(doc)
    const Z = doc.getElementAt(R,2)
    doc.insertAfter(R,null,Z)
    t.equal(toArray(doc,R).map(e => e.name).join(""),'ZXYZ')
    t.end()
})
test('copy element to back',t => {
    const doc = new DocGraph({host:'A'})
    const R = makeStandardArrayTest(doc)
    const X = doc.getElementAt(R,0)
    const Z = doc.getElementAt(R,2)
    doc.insertAfter(R,Z,X)
    t.equal(toArray(doc,R).map(e => e.name).join(""),'XYZX')
    t.end()
})
test('delete w/ duplicates start',t => {
    const doc = new DocGraph({host:'A'})
    const R = makeStandardArrayTest(doc)
    const X = doc.getElementAt(R,0)
    const Z = doc.getElementAt(R,2)
    doc.insertAfter(R,Z,X)
    t.equal(toArray(doc,R).map(e => e.name).join(""),'XYZX')
    doc.removeElement(R,0)
    t.equal(toArray(doc,R).map(e => e.name).join(""),'YZX')
    doc.removeElement(R,2)
    t.equal(toArray(doc,R).map(e => e.name).join(""),'YZ')
    return t.end()
})


test('move element from array A to array B then back', t => {
    const doc = new DocGraph()
    const A = makeStandardArrayTest(doc)
    const B = makeStandardArrayTest(doc)
    const X = doc.getElementAt(A,0)
    doc.removeElement(A,0)
    doc.insertAfter(B,null,X)
    t.equal(toArray(doc,A).map(e => e.name).join(""),'YZ')
    t.equal(toArray(doc,B).map(e => e.name).join(""),'XXYZ')
    doc.removeElement(B,0)
    doc.insertAfter(A,null,X)
    t.equal(toArray(doc,A).map(e => e.name).join(""),'XYZ')
    t.equal(toArray(doc,B).map(e => e.name).join(""),'XYZ')
    return t.end()

})
