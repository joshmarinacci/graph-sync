const test = require('tape')
const Sync = require('./sync.js')
const {ObjectSyncProtocol,
    SET_PROPERTY, CREATE_OBJECT, CREATE_PROPERTY, DELETE_PROPERTY, DELETE_OBJECT,
    CREATE_ARRAY, INSERT_ELEMENT,
} = Sync

function performEvent(e,graph) {
    // console.log("performing",e)
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
    const sync = new ObjectSyncProtocol()
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
    const sync = new ObjectSyncProtocol()
    const history = []
    sync.onChange((e)=>{
        const obj = { type:e.type}
        if(e.type === CREATE_PROPERTY || e.type === SET_PROPERTY) {
            obj.name = e.name
            obj.value = e.value
        }
        history.push(obj)
    })
    const A = sync.createObject()
    sync.createProperty(A,'id','A')
    sync.createProperty(A,'x',100)
    sync.setProperty(A,'x',200)

    t.deepEquals(history,[
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
    const A = new ObjectSyncProtocol()
    const B = new ObjectSyncProtocol()

    function sync(X,Y) {
        X.onChange(e => {
            // console.log("client changed",e)
            if(e.type === CREATE_OBJECT) Y.createObject(e.id)
            if(e.type === CREATE_PROPERTY) Y.createProperty(e.object, e.name, e.value)
            if(e.type === SET_PROPERTY) Y.setProperty(e.object, e.name, e.value)
            if(e.type === DELETE_PROPERTY) Y.deleteProperty(e.object, e.name)
            if(e.type === DELETE_OBJECT) Y.deleteObject(e.id)
        })
    }
    sync(A,B)
    sync(B,A)

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
                // console.log('graph changed',e)
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
                    console.log("looking for last",this.findLastPropertyValue(e.object, e.name))
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
            // console.log("last is",last)
            if(last.type === SET_PROPERTY) {
                // console.log("undoing")
                this.graph.setProperty(last.object,last.name, last.oldValue)
                return
            }
            throw new Error(`undo for type not supported: ${last.type}`)
        }
        redo() {
            const last = this.history[this.current]
            // console.log("last is",last)
            if(last.type === SET_PROPERTY) {
                // console.log("redoing")
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

    const sync = new ObjectSyncProtocol()
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
                // console.log("graph changed",e)
            })
        }

        getJSONViewById(id) {
            // console.log("getting the view for",id)
            const root = this.graph.getObjectByProperty('id',id)
            // console.log("found the root",root)
            return this.getJSONViewByRealId(root)
        }
        getJSONViewByRealId(id) {
            const props = this.graph.getPropertiesForObject(id)
            // console.log("got the properties",props)
            const rootObj = {}
            props.forEach(name => {
                rootObj[name] = this.graph.getPropertyValue(id,name)
                if(name === 'children') {
                    rootObj.children = rootObj[name].map((objid)=>{
                        // console.log("expanding child",objid)
                        return this.getJSONViewByRealId(objid)
                    })
                }
            })

            return rootObj
        }
    }

    const sync = new ObjectSyncProtocol()
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
            // console.log("unpausing. buffer is", this.buffer)
            const b = {}
            this.buffer.forEach(e => {
                if(e.type === SET_PROPERTY) {
                    if(!b[e.object]) b[e.object] = {}
                    b[e.object][e.name] = e.value
                }
            })
            // console.log("condensed",b)
            Object.keys(b).forEach((okey) =>{
                // console.log("obj",okey)
                Object.keys(b[okey]).forEach(name=>{
                    // console.log("name",name,b[okey][name])
                    this.graph.setProperty(okey,name,b[okey][name])
                })
            })
            this.paused = false
            this.buffer = []
        }
    }

    const sync = new ObjectSyncProtocol()
    const history = []
    sync.onChange((e)=>{
        history.push(e)
    })

    const throttle = new Throttle(sync)

    const A = throttle.createObject()
    throttle.createProperty(A,'x',100)
    throttle.pause()
    throttle.setProperty(A,'x',101)
    throttle.setProperty(A,'x',102)
    throttle.setProperty(A,'x',103)
    throttle.unpause()

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
            // console.log("client changed",e)
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
    const sync = new ObjectSyncProtocol()

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
    const sync = new ObjectSyncProtocol()
    sync.onChange((e)=> {
        historyCount++
        history.push({event:e,count:historyCount})
    })
    const R = sync.createObject()
    sync.createProperty(R,'id','R')
    sync.createProperty(R,'x',100)
    sync.setProperty(R,'x',200)

    t.deepEquals(sync.dumpGraph(),{ R: { id:'R', x:200 }})

    function updateFrom(from,to) {
        history.forEach((e)=> performEvent(e.event,to))
    }
    const sync2 = new ObjectSyncProtocol()
    updateFrom(sync,sync2)

    t.deepEquals(sync2.dumpGraph(),{ R: { id:'R', x:200 }})

    t.end()
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

    console.log("========= offline")

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


    // clearHistory(Bhistory)
    updateFromA(A,B)
    // clearHistory(Ahistory)


    t.deepEqual(A.dumpGraph(), B.dumpGraph())
    /*{
        R: {id:'R'},
        S: {id:'S'},
        T: {id:'T'},
        U: {id:'U'},
        arr:[R,U,T,S]
    })
    t.deepEqual(B.dumpGraph(),{
        R: {id:'R'},
        S: {id:'S'},
        T: {id:'T'},
        U: {id:'U'},
        arr:[R,U,T,S]
    })*/

    /*

    //disconnect A & B

    A.removeElement(arr,0)
    const V = B.createObject()
    B.insertElement(arr,1,V)

    //reconnect A & B
    //sync A & B

    t.deepEqual(A.dumpGraph(),{arr:[V,U,T,S]})
    t.deepEqual(B.dumpGraph(),{arr:[V,U,T,S]})
    */

    t.end()
})

/*
// A creates obj & prop
// B connects to A and gets history
// A & B disconnect
// A adds object and sets prop of first obj
// B adds object and sets prop on first obj
// A & B reconnect and sync
// verify that both A & B are the same
test('tree disconnected two way sync',t=>{
    const A = new ObjectSyncProtocol()
    const R = A.createObject()
    A.setProperty(R,'x',100)
    A.createProperty(R,'children',[])

    const B = new ObjectSyncProtocol()
    //sync A to B
    //disconnect A & B

    //A updates property on R
    A.setProperty(R,'x',660)
    //A adds object S
    const S = A.createObject()
    A.createProperty(S,'x',44)
    A.createProperty(S,'y', 449)
    //add S to children of R
    A.createProperty(R,'children',[S])

    //B updates property on R
    B.setProperty(R,'x',760)
    //B adds object S
    const T = B.createObject()
    B.createProperty(T,'x',55)
    //add T to children of R
    A.createProperty(R,'children',[T])

    // reconnect A & B and sync
    //verify that both A & B are the same

    t.deepEquals(A.dumpGraph(),{
        R: { id:'R', x:660, children:[S,T]},
        S: { id:'S', x:44, y:449},
        T: { id:'T', x:55}
    })

    t.end()

})
*/