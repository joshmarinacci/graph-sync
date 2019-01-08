const test = require('tape')
const Sync = require('./sync.js')
const {ObjectSyncProtocol, HistoryView, DocGraph,
    SET_PROPERTY, CREATE_OBJECT, CREATE_PROPERTY, DELETE_PROPERTY, DELETE_OBJECT,
    CREATE_ARRAY, INSERT_ELEMENT,
} = Sync

function performEvent(e,graph) {
    if(e.type === CREATE_OBJECT) graph.createObject(e.id)
    if(e.type === CREATE_PROPERTY) graph.createProperty(e.object, e.name, e.value)
    if(e.type === SET_PROPERTY) graph.setProperty(e.object, e.name, e.value)
    if(e.type === DELETE_PROPERTY) graph.deleteProperty(e.object, e.name)
    if(e.type === DELETE_OBJECT) graph.deleteObject(e.id)
    if(e.type === CREATE_ARRAY) return graph.createArray(e.id)
    if(e.type === INSERT_ELEMENT) return graph.insertElementDirect(e.object,e.after,e.value,e.entry,e.timestamp)
}
/*
 create object A as child of root with property x = 100
  */
test('basic',t => {
    const sync = new DocGraph()
    const root = sync.createObject()
    sync.createProperty(root,'id','root')


    const A = sync.createObject()
    sync.createProperty(A,'id','A')
    sync.createProperty(A,'x',100)

    sync.createProperty(root,'children',[])
    sync.setProperty(root,'children',[A])


    const graph1 = sync.dumpGraph()
    t.deepEquals(graph1, {
        root: {id: 'root', children: [A]},
        A: {id: 'A',x:100},
    })
    t.end()
})


/*
 * create object A with property x = 100
 * set x to 200
 * dump the history. shows create object, create prop, set prop
 */
test('history', t => {
    const sync = new DocGraph()
    const history = new HistoryView(sync)
    const A = sync.createObject()
    sync.createProperty(A,'id','A')
    sync.createProperty(A,'x',100)
    sync.setProperty(A,'x',200)

    t.deepEquals(history.dump(),[
        { type:CREATE_OBJECT},
        { type:CREATE_PROPERTY,name:'id',value:'A'},
        { type:CREATE_PROPERTY,name:'x',value:100},
        { type:SET_PROPERTY,name:'x',value:200},
    ])

    t.end()
})

/*
user A create object R with R.x = 100
sync
user B sets R.x to 200
sync
user A can see R.x = 200
*/
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


/*
create object R with R.x = 100
set R.x = 200
check undo queue
undo it
check
redo it
check

*/

test('undo',t => {
    class UndoQueue {
        constructor(graph) {
            this.graph = graph
            this.history = []
            this.current = 0
            graph.onChange((e)=>{
                this.current++
                if(e.type === CREATE_OBJECT) {
                    this.history.push({
                        type:e.type,
                        object:e.object
                    })
                    return
                }
                if(e.type === CREATE_PROPERTY) {
                    this.history.push({
                        type:e.type,
                        object:e.object,
                        name:e.name,
                        value:e.value
                    })
                    return
                }
                if(e.type === SET_PROPERTY) {
                    this.history.push({
                        id:Math.random(),
                        type: e.type,
                        object: e.object,
                        name: e.name,
                        oldValue: this.findLastPropertyValue(e.object, e.name),
                        newValue: e.value
                    })
                }
            })
        }
        undo() {
            this.current--
            const last = this.history[this.current]
            if(last.type === SET_PROPERTY) {
                this.graph.setProperty(last.object,last.name, last.oldValue)
                return
            }
            throw new Error(`undo for type not supported: ${last.type}`)
        }
        redo() {
            const last = this.history[this.current]
            if(last.type === SET_PROPERTY) {
                this.graph.setProperty(last.object,last.name,last.oldValue)
                return
            }
            throw new Error(`redo for type not supported: ${last.type}`)
        }
        findLastPropertyValue(objid,propname) {
            for(let i=this.history.length-1; i>=0; i--) {
                const h = this.history[i]
                if(h.object === objid && h.name === propname) {
                    if(h.type === SET_PROPERTY) return h.newValue
                    if(h.type === CREATE_PROPERTY) return h.value
                }
            }
            console.error(`could not find history entry for property ${objid}:${propname}`)
            return null
        }
        dump() {
            return this.history.map(h=>{
                const entry = {
                    type:h.type
                }
                if(h.type === CREATE_PROPERTY) {
                    entry.name = h.name
                    entry.value = h.value
                }
                if(h.type === SET_PROPERTY) {
                    entry.name = h.name
                    entry.oldValue = h.oldValue
                    entry.newValue = h.newValue
                }
                return entry
            })
        }
    }

    const sync = new DocGraph({host:'doc'})
    const undoqueue = new UndoQueue(sync)

    const R = sync.createObject()
    sync.createProperty(R,'x',100)
    sync.setProperty(R,'x',200)
    t.deepEquals(undoqueue.dump(),[
        {type:CREATE_OBJECT},
        {type:CREATE_PROPERTY,name:'x',value:100},
        {type:SET_PROPERTY,name:'x',oldValue:100, newValue:200},
    ])

    t.equals(sync.getPropertyValue(R,'x'),200)

    undoqueue.undo()
    t.equals(sync.getPropertyValue(R,'x'),100)
    undoqueue.redo()
    t.equals(sync.getPropertyValue(R,'x'),200)
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
        }
        createProperty(objid, propname, value) {
            if(!this.paused) {
                return this.graph.createProperty(objid,propname,value)
            }
        }
        createObject() {
            if(!this.paused) {
                return this.graph.createObject()
            }
        }
        setProperty(objid, propname, propvalue) {
            if(!this.paused) {
                return this.graph.setProperty(objid,propname,propvalue)
            }
            this.buffer.push({type:SET_PROPERTY,object:objid, name:propname, value:propvalue})
        }

        pause() {
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
                    this.graph.setProperty(okey,name,b[okey][name])
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
    throttle.unpause()

    history.forEach(h=>{
        delete h.host
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
    const history = []
    let historyCount = 0
    const sync = new DocGraph()
    sync.onChange((e)=> {
        historyCount++
        history.push({event:e,count:historyCount})
    })
    const R = sync.createObject()
    sync.createProperty(R,'id','R')
    sync.createProperty(R,'x',100)
    sync.setProperty(R,'x',200)

    t.deepEquals(sync.dumpGraph(),{ R: { id:'R', x:200 }})

    const sync2 = new DocGraph()
    history.forEach(e => sync2.process(e.event))

    t.deepEquals(sync2.dumpGraph(),{ R: { id:'R', x:200 }})

    t.end()
})

return

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
    history.forEach(e => C.process(e))
    t.equals(C.getPropertyValue(R,'name'),'foo')

    t.end()
})


//create array, create object, insert object into array
test('array object causality',t => {

})


//        set property to 5, set property to 4 before the 5 setter, but received later. resolve with timestamp.
test('out of order, two property sets, last one should win',t => {
})

//multiple operations come in out of order, one that can never be resolved. indicate it stays in the wait queue forever
test('completely unresolved operation',t => {

})

//    sync receives external operation and applies it but doesn't rebroadcast it
test('dont recurse 1',t => {
})

//     sync receives external operation on network from self, don't apply it
test('dont recurse 2',t => {
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

